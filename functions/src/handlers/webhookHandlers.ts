import {webhook} from "@line/bot-sdk";
import {getFirestore, Timestamp, FieldValue} from "firebase-admin/firestore";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import {replyText, getProfile} from "../services/lineClient";
import {getUnsubmittedTasks, KlmsApiError} from "../services/klmsClient";
import {decrypt} from "../utils/crypto";
import {
  buildWelcomeMessage,
  buildHelpMessage,
  buildRegistrationMessage,
  buildTaskList,
} from "../utils/messageTemplates";
import {User, TaskCache} from "../types";

function db() {
  return getFirestore();
}

export async function handleEvent(
  event: webhook.Event,
  channelAccessToken: string,
  klmsEncryptionKey: string,
  projectId: string
): Promise<void> {
  switch (event.type) {
  case "follow":
    await handleFollow(event, channelAccessToken);
    break;
  case "unfollow":
    await handleUnfollow(event);
    break;
  case "join":
    await handleJoin(event, channelAccessToken);
    break;
  case "leave":
    await handleLeave(event);
    break;
  case "message":
    if (event.message.type === "text") {
      await handleTextMessage(
        event,
        channelAccessToken,
        klmsEncryptionKey,
        projectId
      );
    }
    break;
  default:
    break;
  }
}

async function handleFollow(
  event: webhook.FollowEvent,
  channelAccessToken: string
): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) return;

  const userRef = db().collection("users").where("lineUserId", "==", userId);
  const existing = await userRef.get();

  if (existing.empty) {
    let displayName = "ユーザー";
    try {
      const profile = await getProfile(channelAccessToken, userId);
      displayName = profile.displayName;
    } catch {
      // Use default
    }

    await db().collection("users").add({
      lineUserId: userId,
      displayName,
      klmsToken: "",
      klmsTokenIv: "",
      klmsUserId: null,
      isActive: true,
      registeredAt: Timestamp.now(),
      lastTokenVerifiedAt: Timestamp.now(),
      tokenStatus: "unset",
      settings: {
        morningReminder: true,
        urgentReminder: true,
      },
    });
  } else {
    const doc = existing.docs[0];
    await doc.ref.update({isActive: true});
  }

  if (event.replyToken) {
    await replyText(channelAccessToken, event.replyToken, buildWelcomeMessage());
  }
}

async function handleUnfollow(event: webhook.UnfollowEvent): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) return;

  const userRef = db().collection("users").where("lineUserId", "==", userId);
  const snapshot = await userRef.get();
  for (const doc of snapshot.docs) {
    await doc.ref.update({isActive: false});
  }
}

async function handleJoin(
  event: webhook.JoinEvent,
  channelAccessToken: string
): Promise<void> {
  const source = event.source;
  const groupId = source && source.type === "group"
    ? (source as webhook.GroupSource).groupId
    : undefined;
  if (!groupId) return;

  const groupRef = db()
    .collection("groups")
    .where("lineGroupId", "==", groupId);
  const existing = await groupRef.get();

  if (existing.empty) {
    await db().collection("groups").add({
      lineGroupId: groupId,
      groupName: "",
      registeredBy: "",
      members: [],
      isActive: true,
      createdAt: Timestamp.now(),
      settings: {urgentReminder: true},
    });
  } else {
    await existing.docs[0].ref.update({isActive: true});
  }

  if (event.replyToken) {
    await replyText(
      channelAccessToken,
      event.replyToken,
      "KLMS Reminder Bot がグループに参加しました！\n" +
      "メンバーはBotとの個人チャットで「登録」してから、\n" +
      "このグループで「グループ通知ON」と送信してください。"
    );
  }
}

async function handleLeave(event: webhook.LeaveEvent): Promise<void> {
  const source = event.source;
  const groupId = source && source.type === "group"
    ? (source as webhook.GroupSource).groupId
    : undefined;
  if (!groupId) return;

  const groupRef = db()
    .collection("groups")
    .where("lineGroupId", "==", groupId);
  const snapshot = await groupRef.get();
  for (const doc of snapshot.docs) {
    await doc.ref.update({isActive: false});
  }
}

async function handleTextMessage(
  event: webhook.MessageEvent,
  channelAccessToken: string,
  klmsEncKey: string,
  projectId: string
): Promise<void> {
  const message = event.message as webhook.TextMessageContent;
  const text = message.text.trim();
  const userId = event.source?.userId;
  if (!userId || !event.replyToken) return;

  const source = event.source;
  const isGroup = source?.type === "group" || source?.type === "room";

  const command = text.toLowerCase();

  if (isGroup) {
    const groupId = source?.type === "group"
      ? (source as webhook.GroupSource).groupId
      : "";
    await handleGroupCommand(
      command,
      userId,
      groupId,
      event.replyToken,
      channelAccessToken
    );
    return;
  }

  switch (command) {
  case "登録":
  case "register":
    await handleRegister(
      userId, event.replyToken, channelAccessToken, projectId
    );
    break;
  case "課題":
  case "課題一覧":
  case "tasks":
    await handleTasks(
      userId, event.replyToken, channelAccessToken, klmsEncKey, null
    );
    break;
  case "今日":
  case "today":
    await handleTasks(
      userId, event.replyToken, channelAccessToken, klmsEncKey, "today"
    );
    break;
  case "明日":
  case "tomorrow":
    await handleTasks(
      userId, event.replyToken, channelAccessToken, klmsEncKey, "tomorrow"
    );
    break;
  case "今週":
  case "week":
    await handleTasks(
      userId, event.replyToken, channelAccessToken, klmsEncKey, "week"
    );
    break;
  case "通知on":
  case "on":
    await handleNotificationToggle(
      userId, event.replyToken, channelAccessToken, true
    );
    break;
  case "通知off":
  case "off":
    await handleNotificationToggle(
      userId, event.replyToken, channelAccessToken, false
    );
    break;
  case "トークン更新":
  case "update-token":
    await handleRegister(
      userId, event.replyToken, channelAccessToken, projectId
    );
    break;
  case "ヘルプ":
  case "help":
    await replyText(channelAccessToken, event.replyToken, buildHelpMessage());
    break;
  default:
    break;
  }
}

async function handleGroupCommand(
  command: string,
  userId: string,
  groupId: string,
  replyToken: string,
  channelAccessToken: string
): Promise<void> {
  if (command === "グループ通知on") {
    const userSnapshot = await db()
      .collection("users")
      .where("lineUserId", "==", userId)
      .get();
    if (
      userSnapshot.empty ||
      userSnapshot.docs[0].data().tokenStatus !== "valid"
    ) {
      await replyText(
        channelAccessToken,
        replyToken,
        "先にBotとの個人チャットで「登録」を完了してください。"
      );
      return;
    }

    const groupSnapshot = await db()
      .collection("groups")
      .where("lineGroupId", "==", groupId)
      .get();
    if (!groupSnapshot.empty) {
      await groupSnapshot.docs[0].ref.update({
        members: FieldValue.arrayUnion(userId),
      });
      await replyText(
        channelAccessToken,
        replyToken,
        "グループ通知に登録しました！締切間近の課題がグループに通知されます。"
      );
    }
  } else if (command === "グループ通知off") {
    const groupSnapshot = await db()
      .collection("groups")
      .where("lineGroupId", "==", groupId)
      .get();
    if (!groupSnapshot.empty) {
      await groupSnapshot.docs[0].ref.update({
        members: FieldValue.arrayRemove(userId),
      });
      await replyText(
        channelAccessToken,
        replyToken,
        "グループ通知を解除しました。"
      );
    }
  }
}

async function handleRegister(
  userId: string,
  replyToken: string,
  channelAccessToken: string,
  projectId: string
): Promise<void> {
  const code = crypto.randomBytes(4).toString("hex");

  await db().collection("registrationTokens").doc(code).set({
    lineUserId: userId,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    used: false,
  });

  const url =
    `https://asia-northeast1-${projectId}.cloudfunctions.net/tokenRegistration?code=${code}`;

  await replyText(
    channelAccessToken,
    replyToken,
    buildRegistrationMessage(url)
  );
}

async function handleTasks(
  userId: string,
  replyToken: string,
  channelAccessToken: string,
  klmsEncKey: string,
  filter: "today" | "tomorrow" | "week" | null
): Promise<void> {
  const userSnapshot = await db()
    .collection("users")
    .where("lineUserId", "==", userId)
    .get();

  if (userSnapshot.empty) {
    await replyText(
      channelAccessToken,
      replyToken,
      "まず「登録」コマンドでKLMSアカウントを連携してください。"
    );
    return;
  }

  const userData = userSnapshot.docs[0].data() as User;

  if (userData.tokenStatus !== "valid") {
    await replyText(
      channelAccessToken,
      replyToken,
      "KLMSトークンが未設定または無効です。「登録」で再設定してください。"
    );
    return;
  }

  try {
    const token = decrypt(userData.klmsToken, userData.klmsTokenIv, klmsEncKey);
    const tasks = await getUnsubmittedTasks(token);

    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    const jstToday = new Date(
      jstNow.getFullYear(),
      jstNow.getMonth(),
      jstNow.getDate()
    );

    let filteredTasks = tasks;
    if (filter) {
      filteredTasks = tasks.filter((t) => {
        if (!t.assignment.due_at) return false;
        const dueDate = new Date(t.assignment.due_at);
        const dueDateJst = new Date(dueDate.getTime() + jstOffset);
        const dueDay = new Date(
          dueDateJst.getFullYear(),
          dueDateJst.getMonth(),
          dueDateJst.getDate()
        );
        const diffDays = Math.floor(
          (dueDay.getTime() - jstToday.getTime()) / (1000 * 60 * 60 * 24)
        );

        switch (filter) {
        case "today":
          return diffDays === 0;
        case "tomorrow":
          return diffDays === 1;
        case "week":
          return diffDays >= 0 && diffDays <= 7;
        }
      });
    }

    const taskCacheData: TaskCache[] = filteredTasks.map((t) => ({
      lineUserId: userId,
      courseId: t.course.id,
      assignmentId: t.assignment.id,
      courseName: t.course.name,
      assignmentName: t.assignment.name,
      dueAt: t.assignment.due_at
        ? Timestamp.fromDate(new Date(t.assignment.due_at))
        : null,
      pointsPossible: t.assignment.points_possible,
      htmlUrl: t.assignment.html_url,
      submissionStatus: "unsubmitted" as const,
      lastCheckedAt: Timestamp.now(),
      notifiedMorning: false,
      notifiedUrgent: false,
    }));

    await replyText(
      channelAccessToken,
      replyToken,
      buildTaskList(taskCacheData)
    );
  } catch (error) {
    if (error instanceof KlmsApiError && error.status === 401) {
      await userSnapshot.docs[0].ref.update({tokenStatus: "invalid"});
      await replyText(
        channelAccessToken,
        replyToken,
        "KLMSトークンが無効です。「トークン更新」で再登録してください。"
      );
    } else {
      logger.error("Error fetching tasks", error);
      await replyText(
        channelAccessToken,
        replyToken,
        "課題の取得中にエラーが発生しました。しばらくしてから再試行してください。"
      );
    }
  }
}

async function handleNotificationToggle(
  userId: string,
  replyToken: string,
  channelAccessToken: string,
  enabled: boolean
): Promise<void> {
  const userSnapshot = await db()
    .collection("users")
    .where("lineUserId", "==", userId)
    .get();

  if (userSnapshot.empty) {
    await replyText(
      channelAccessToken,
      replyToken,
      "まず「登録」コマンドでKLMSアカウントを連携してください。"
    );
    return;
  }

  await userSnapshot.docs[0].ref.update({
    "settings.morningReminder": enabled,
    "settings.urgentReminder": enabled,
  });

  await replyText(
    channelAccessToken,
    replyToken,
    enabled
      ? "通知を有効にしました ✅"
      : "通知を無効にしました。再度有効にするには「通知ON」と送信してください。"
  );
}
