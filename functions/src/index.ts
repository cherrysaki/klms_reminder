import {onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {initializeApp} from "firebase-admin/app";
import * as logger from "firebase-functions/logger";
import {
  lineChannelSecret,
  lineChannelAccessToken,
  klmsEncryptionKey,
  REGION,
} from "./config";
import {verifySignature} from "./services/lineClient";
import {handleEvent} from "./handlers/webhookHandlers";
import {handleTokenRegistration} from "./handlers/registration";
import {runMorningDigest} from "./schedulers/morningDigest";
import {runUrgentReminder} from "./schedulers/urgentReminder";

initializeApp();

export const lineWebhook = onRequest(
  {
    region: REGION,
    secrets: [lineChannelSecret, lineChannelAccessToken, klmsEncryptionKey],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const signature = req.headers["x-line-signature"] as string;
    if (!signature) {
      res.status(400).send("Missing signature");
      return;
    }

    const rawBody = JSON.stringify(req.body);
    if (!verifySignature(rawBody, signature, lineChannelSecret.value())) {
      res.status(401).send("Invalid signature");
      return;
    }

    const events = req.body.events || [];
    const projectId = process.env.GCLOUD_PROJECT || "klms-reminder";

    try {
      await Promise.all(
        events.map((event: unknown) =>
          handleEvent(
            event as import("@line/bot-sdk").webhook.Event,
            lineChannelAccessToken.value(),
            klmsEncryptionKey.value(),
            projectId
          )
        )
      );
    } catch (error) {
      logger.error("Webhook processing error", error);
    }

    res.status(200).json({status: "ok"});
  }
);

export const tokenRegistration = onRequest(
  {
    region: REGION,
    secrets: [lineChannelAccessToken, klmsEncryptionKey],
  },
  async (req, res) => {
    await handleTokenRegistration(
      req,
      res,
      lineChannelAccessToken.value(),
      klmsEncryptionKey.value()
    );
  }
);

export const morningDigest = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "Asia/Tokyo",
    region: REGION,
    secrets: [lineChannelAccessToken, klmsEncryptionKey],
  },
  async () => {
    await runMorningDigest(
      lineChannelAccessToken.value(),
      klmsEncryptionKey.value()
    );
  }
);

export const urgentReminder = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "Asia/Tokyo",
    region: REGION,
    secrets: [lineChannelAccessToken, klmsEncryptionKey],
  },
  async () => {
    await runUrgentReminder(lineChannelAccessToken.value());
  }
);
