import {getFirestore, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {pushText} from "../services/lineClient";
import {buildUrgentReminder, buildGroupUrgentReminder} from "../utils/messageTemplates";
import {User, TaskCache, Group} from "../types";

const db = getFirestore();

export async function runUrgentReminder(
  channelAccessToken: string
): Promise<void> {
  const now = Date.now();
  const in24Hours = now + 24 * 60 * 60 * 1000;

  // Query unsubmitted tasks due within 24 hours that haven't been notified
  const tasksSnapshot = await db
    .collection("taskCache")
    .where("submissionStatus", "==", "unsubmitted")
    .where("notifiedUrgent", "==", false)
    .where("dueAt", ">=", Timestamp.fromMillis(now))
    .where("dueAt", "<=", Timestamp.fromMillis(in24Hours))
    .get();

  if (tasksSnapshot.empty) {
    logger.info("Urgent reminder: no urgent tasks found");
    return;
  }

  // Group tasks by user
  const userTasks = new Map<string, TaskCache[]>();
  for (const doc of tasksSnapshot.docs) {
    const task = doc.data() as TaskCache;
    const existing = userTasks.get(task.lineUserId) || [];
    existing.push(task);
    userTasks.set(task.lineUserId, existing);
  }

  logger.info(
    `Urgent reminder: ${tasksSnapshot.size} tasks for ${userTasks.size} users`
  );

  let sentCount = 0;

  // Send individual notifications
  for (const [lineUserId, tasks] of userTasks) {
    const userSnapshot = await db
      .collection("users")
      .where("lineUserId", "==", lineUserId)
      .get();

    if (userSnapshot.empty) continue;
    const user = userSnapshot.docs[0].data() as User;
    if (!user.isActive || !user.settings.urgentReminder) continue;

    try {
      const message = buildUrgentReminder(tasks);
      await pushText(channelAccessToken, lineUserId, message);
      sentCount++;
    } catch (error) {
      logger.error(`Failed to send urgent reminder to ${lineUserId}`, error);
    }
  }

  // Send group notifications
  const groupsSnapshot = await db
    .collection("groups")
    .where("isActive", "==", true)
    .where("settings.urgentReminder", "==", true)
    .get();

  for (const groupDoc of groupsSnapshot.docs) {
    const group = groupDoc.data() as Group;
    if (group.members.length === 0) continue;

    const memberTasks = new Map<string, TaskCache[]>();

    for (const memberId of group.members) {
      const tasks = userTasks.get(memberId);
      if (!tasks || tasks.length === 0) continue;

      const userSnapshot = await db
        .collection("users")
        .where("lineUserId", "==", memberId)
        .get();
      if (userSnapshot.empty) continue;

      const displayName = (userSnapshot.docs[0].data() as User).displayName;
      memberTasks.set(displayName, tasks);
    }

    if (memberTasks.size > 0) {
      try {
        const message = buildGroupUrgentReminder(memberTasks);
        await pushText(channelAccessToken, group.lineGroupId, message);
      } catch (error) {
        logger.error(
          `Failed to send group reminder to ${group.lineGroupId}`,
          error
        );
      }
    }
  }

  // Mark tasks as notified
  const batch = db.batch();
  for (const doc of tasksSnapshot.docs) {
    batch.update(doc.ref, {notifiedUrgent: true});
  }
  await batch.commit();

  logger.info(`Urgent reminder complete: ${sentCount} individual notifications sent`);
}
