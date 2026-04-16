import {Request, Response} from "express";
import {getFirestore, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {verifyToken} from "../services/klmsClient";
import {pushText} from "../services/lineClient";
import {encrypt} from "../utils/crypto";
import {RegistrationToken} from "../types";

function db() {
  return getFirestore();
}

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - KLMS Reminder</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      padding: 32px;
      max-width: 480px;
      width: 100%;
    }
    h1 { font-size: 1.4em; margin-bottom: 16px; color: #1a1a1a; }
    p { margin-bottom: 12px; line-height: 1.6; font-size: 0.95em; }
    .steps { background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .steps ol { padding-left: 20px; }
    .steps li { margin-bottom: 8px; line-height: 1.5; }
    input[type="text"] {
      width: 100%;
      padding: 12px;
      border: 2px solid #ddd;
      border-radius: 8px;
      font-size: 16px;
      margin: 12px 0;
      transition: border-color 0.2s;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #06c755;
    }
    button {
      background: #06c755;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    button:hover { background: #05b34c; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .success { color: #06c755; }
    .error { color: #e53e3e; }
    a { color: #06c755; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

export async function handleTokenRegistration(
  req: Request,
  res: Response,
  channelAccessToken: string,
  klmsEncryptionKey: string
): Promise<void> {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).send(renderPage("エラー", `
      <h1 class="error">無効なリンク</h1>
      <p>LINE Botから「登録」コマンドで新しいリンクを取得してください。</p>
    `));
    return;
  }

  if (req.method === "GET") {
    const tokenDoc = await db()
      .collection("registrationTokens")
      .doc(code)
      .get();

    if (!tokenDoc.exists) {
      res.status(404).send(renderPage("エラー", `
        <h1 class="error">リンクが無効です</h1>
        <p>LINE Botから「登録」コマンドで新しいリンクを取得してください。</p>
      `));
      return;
    }

    const tokenData = tokenDoc.data() as RegistrationToken;
    if (tokenData.used || tokenData.expiresAt.toDate() < new Date()) {
      res.status(410).send(renderPage("期限切れ", `
        <h1 class="error">リンクの有効期限が切れました</h1>
        <p>LINE Botから「登録」または「トークン更新」コマンドで新しいリンクを取得してください。</p>
      `));
      return;
    }

    res.send(renderPage("KLMSトークン登録", `
      <h1>KLMSアクセストークンの登録</h1>
      <div class="steps">
        <p><strong>トークンの取得手順:</strong></p>
        <ol>
          <li><a href="https://lms.keio.jp" target="_blank">KLMS</a> にログイン</li>
          <li>左メニュー「アカウント」→「設定」を開く</li>
          <li>「+ 新しいアクセストークンを生成する」をクリック</li>
          <li>用途名を入力（例: "Reminder Bot"）して「トークンを生成する」</li>
          <li>表示されたトークンをコピー</li>
        </ol>
      </div>
      <form method="POST" action="?code=${code}">
        <input type="text" name="token" placeholder="アクセストークンを貼り付け"
               required autocomplete="off" />
        <button type="submit">登録する</button>
      </form>
    `));
    return;
  }

  if (req.method === "POST") {
    const klmsToken = req.body?.token as string;

    if (!klmsToken || klmsToken.trim().length === 0) {
      res.status(400).send(renderPage("エラー", `
        <h1 class="error">トークンが入力されていません</h1>
        <p><a href="?code=${code}">戻って入力してください</a></p>
      `));
      return;
    }

    const tokenDoc = await db()
      .collection("registrationTokens")
      .doc(code)
      .get();

    if (!tokenDoc.exists) {
      res.status(404).send(renderPage("エラー", `
        <h1 class="error">リンクが無効です</h1>
      `));
      return;
    }

    const tokenData = tokenDoc.data() as RegistrationToken;
    if (tokenData.used || tokenData.expiresAt.toDate() < new Date()) {
      res.status(410).send(renderPage("期限切れ", `
        <h1 class="error">リンクの有効期限が切れました</h1>
        <p>LINE Botから再度「登録」コマンドを送信してください。</p>
      `));
      return;
    }

    try {
      const canvasUser = await verifyToken(klmsToken.trim());

      const encrypted = encrypt(klmsToken.trim(), klmsEncryptionKey);

      const userSnapshot = await db()
        .collection("users")
        .where("lineUserId", "==", tokenData.lineUserId)
        .get();

      if (!userSnapshot.empty) {
        await userSnapshot.docs[0].ref.update({
          klmsToken: encrypted.encrypted,
          klmsTokenIv: encrypted.iv,
          klmsUserId: canvasUser.id,
          tokenStatus: "valid",
          lastTokenVerifiedAt: Timestamp.now(),
        });
      } else {
        await db().collection("users").add({
          lineUserId: tokenData.lineUserId,
          displayName: canvasUser.name,
          klmsToken: encrypted.encrypted,
          klmsTokenIv: encrypted.iv,
          klmsUserId: canvasUser.id,
          isActive: true,
          registeredAt: Timestamp.now(),
          lastTokenVerifiedAt: Timestamp.now(),
          tokenStatus: "valid",
          settings: {
            morningReminder: true,
            urgentReminder: true,
          },
        });
      }

      await tokenDoc.ref.update({used: true});

      try {
        await pushText(
          channelAccessToken,
          tokenData.lineUserId,
          `KLMSアカウント連携が完了しました！ (${canvasUser.name})\n\n` +
          "毎朝8時に未提出課題のリマインドを送信します。\n" +
          "コマンド一覧は「ヘルプ」で確認できます。"
        );
      } catch {
        // Push notification failure is non-critical
      }

      res.send(renderPage("登録完了", `
        <h1 class="success">登録が完了しました！ ✅</h1>
        <p>KLMSアカウント「${canvasUser.name}」と連携しました。</p>
        <p>LINEに戻ってBotからの通知を確認してください。</p>
        <p>このページは閉じて大丈夫です。</p>
      `));
    } catch (error) {
      logger.error("Token registration error", error);
      res.status(400).send(renderPage("エラー", `
        <h1 class="error">トークンの検証に失敗しました</h1>
        <p>トークンが正しいか確認してください。KLMSにログインした状態で新しいトークンを生成し直してみてください。</p>
        <p><a href="?code=${code}">もう一度試す</a></p>
      `));
    }
  }
}
