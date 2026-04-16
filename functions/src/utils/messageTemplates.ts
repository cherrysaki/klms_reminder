import {TaskCache} from "../types";
import {Timestamp} from "firebase-admin/firestore";

function formatDueDate(dueAt: Timestamp | null): string {
  if (!dueAt) return "期限なし";
  const date = dueAt.toDate();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}(${weekday}) ${hours}:${minutes}`;
}

function timeUntilDue(dueAt: Timestamp | null): string {
  if (!dueAt) return "";
  const now = Date.now();
  const due = dueAt.toDate().getTime();
  const diff = due - now;
  if (diff < 0) return " [期限切れ]";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return ` [残り${hours}時間]`;
  const days = Math.floor(hours / 24);
  return ` [残り${days}日]`;
}

export function buildMorningDigest(
  tasks: TaskCache[],
  displayName: string
): string {
  if (tasks.length === 0) {
    return `おはようございます、${displayName}さん！\n未提出の課題はありません。`;
  }

  const grouped = new Map<string, TaskCache[]>();
  for (const task of tasks) {
    const existing = grouped.get(task.courseName) || [];
    existing.push(task);
    grouped.set(task.courseName, existing);
  }

  let message = `おはようございます、${displayName}さん！\n`;
  message += `未提出の課題が${tasks.length}件あります。\n`;
  message += "━━━━━━━━━━━━━━━\n";

  for (const [courseName, courseTasks] of grouped) {
    message += `\n📚 ${courseName}\n`;
    for (const task of courseTasks) {
      message += `  ・${task.assignmentName}\n`;
      message += `    締切: ${formatDueDate(task.dueAt)}`;
      message += `${timeUntilDue(task.dueAt)}\n`;
    }
  }

  return message;
}

export function buildUrgentReminder(tasks: TaskCache[]): string {
  let message = "⚠️ 締切間近の課題があります！\n";
  message += "━━━━━━━━━━━━━━━\n";

  for (const task of tasks) {
    message += `\n📝 ${task.assignmentName}\n`;
    message += `   科目: ${task.courseName}\n`;
    message += `   締切: ${formatDueDate(task.dueAt)}`;
    message += `${timeUntilDue(task.dueAt)}\n`;
    message += `   ${task.htmlUrl}\n`;
  }

  return message;
}

export function buildGroupUrgentReminder(
  memberTasks: Map<string, TaskCache[]>
): string {
  let message = "⚠️ グループメンバーの締切間近の課題\n";
  message += "━━━━━━━━━━━━━━━\n";

  for (const [displayName, tasks] of memberTasks) {
    message += `\n👤 ${displayName}\n`;
    for (const task of tasks) {
      message += `  ・${task.assignmentName} (${task.courseName})\n`;
      message += `    締切: ${formatDueDate(task.dueAt)}\n`;
    }
  }

  return message;
}

export function buildTaskList(tasks: TaskCache[]): string {
  if (tasks.length === 0) {
    return "未提出の課題はありません！🎉";
  }

  const grouped = new Map<string, TaskCache[]>();
  for (const task of tasks) {
    const existing = grouped.get(task.courseName) || [];
    existing.push(task);
    grouped.set(task.courseName, existing);
  }

  let message = `未提出の課題: ${tasks.length}件\n`;
  message += "━━━━━━━━━━━━━━━\n";

  for (const [courseName, courseTasks] of grouped) {
    message += `\n📚 ${courseName}\n`;
    for (const task of courseTasks) {
      message += `  ・${task.assignmentName}\n`;
      message += `    締切: ${formatDueDate(task.dueAt)}`;
      message += `${timeUntilDue(task.dueAt)}\n`;
    }
  }

  return message;
}

export function buildWelcomeMessage(): string {
  return [
    "KLMS Reminder Bot へようこそ！🎓",
    "",
    "このBotは慶應KLMSの課題締切をリマインドします。",
    "",
    "まず「登録」と送信して、KLMSアカウントを連携してください。",
    "",
    "コマンド一覧は「ヘルプ」で確認できます。",
  ].join("\n");
}

export function buildHelpMessage(): string {
  return [
    "📋 コマンド一覧",
    "━━━━━━━━━━━━━━━",
    "登録 - KLMSアカウント連携を開始",
    "課題 - 未提出課題の一覧を表示",
    "今日 - 今日が締切の課題を表示",
    "明日 - 明日が締切の課題を表示",
    "今週 - 今週が締切の課題を表示",
    "通知ON - リマインダーを有効化",
    "通知OFF - リマインダーを無効化",
    "トークン更新 - KLMSトークンを再登録",
    "ヘルプ - このメッセージを表示",
  ].join("\n");
}

export function buildRegistrationMessage(url: string): string {
  return [
    "KLMSアカウントを連携します。",
    "",
    "以下のリンクからKLMSのアクセストークンを登録してください。",
    "（リンクは10分間有効です）",
    "",
    url,
    "",
    "※ トークンの取得方法:",
    "1. KLMS (lms.keio.jp) にログイン",
    "2. アカウント → 設定 → アクセストークンを新規作成",
    "3. 生成されたトークンをコピーして上記リンクに貼り付け",
  ].join("\n");
}
