import {getFirestore, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {getUnsubmittedTasks, KlmsApiError} from "../services/klmsClient";
import {pushText} from "../services/lineClient";
import {decrypt} from "../utils/crypto";
import {buildMorningDigest} from "../utils/messageTemplates";
import {User, TaskCache} from "../types";

const db = getFirestore();

export async function runMorningDigest(
  channelAccessToken: string,
  klmsEncryptionKey: string
): Promise<void> {
  const usersSnapshot = await db
    .collection("users")
    .where("isActive", "==", true)
    .where("tokenStatus", "==", "valid")
    .where("settings.morningReminder", "==", true)
    .get();

  logger.info(`Morning digest: processing ${usersSnapshot.size} users`);

  let sentCount = 0;
  let errorCount = 0;

  for (const userDoc of usersSnapshot.docs) {
    const user = userDoc.data() as User;

    try {
      const token = decrypt(user.klmsToken, user.klmsTokenIv, klmsEncryptionKey);
      const tasks = await getUnsubmittedTasks(token);

      const taskCacheData: TaskCache[] = tasks.map((t) => ({
        lineUserId: user.lineUserId,
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
        notifiedMorning: true,
        notifiedUrgent: false,
      }));

      // Update task cache
      const batch = db.batch();
      for (const task of taskCacheData) {
        const docId =
          `${task.lineUserId}_${task.courseId}_${task.assignmentId}`;
        batch.set(db.collection("taskCache").doc(docId), task, {merge: true});
      }
      await batch.commit();

      if (taskCacheData.length > 0) {
        const message = buildMorningDigest(taskCacheData, user.displayName);
        await pushText(channelAccessToken, user.lineUserId, message);
        sentCount++;
      }

      await userDoc.ref.update({lastTokenVerifiedAt: Timestamp.now()});
    } catch (error) {
      errorCount++;
      if (error instanceof KlmsApiError && error.status === 401) {
        await userDoc.ref.update({tokenStatus: "invalid"});
        try {
          await pushText(
            channelAccessToken,
            user.lineUserId,
            "⚠️ KLMSトークンが無効になりました。\n" +
            "「トークン更新」コマンドで再登録してください。"
          );
        } catch {
          // Ignore push failure
        }
      } else {
        logger.error(`Error processing user ${user.lineUserId}`, error);
      }
    }
  }

  logger.info(
    `Morning digest complete: ${sentCount} sent, ${errorCount} errors`
  );
}
