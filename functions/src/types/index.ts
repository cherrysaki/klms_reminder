import {Timestamp} from "firebase-admin/firestore";

export interface User {
  lineUserId: string;
  displayName: string;
  klmsToken: string;
  klmsTokenIv: string;
  klmsUserId: number | null;
  isActive: boolean;
  registeredAt: Timestamp;
  lastTokenVerifiedAt: Timestamp;
  tokenStatus: "valid" | "invalid" | "unset";
  settings: UserSettings;
}

export interface UserSettings {
  morningReminder: boolean;
  urgentReminder: boolean;
}

export interface Group {
  lineGroupId: string;
  groupName: string;
  registeredBy: string;
  members: string[];
  isActive: boolean;
  createdAt: Timestamp;
  settings: {
    urgentReminder: boolean;
  };
}

export interface TaskCache {
  lineUserId: string;
  courseId: number;
  assignmentId: number;
  courseName: string;
  assignmentName: string;
  dueAt: Timestamp | null;
  pointsPossible: number | null;
  htmlUrl: string;
  submissionStatus: "submitted" | "unsubmitted" | "graded";
  lastCheckedAt: Timestamp;
  notifiedMorning: boolean;
  notifiedUrgent: boolean;
}

export interface RegistrationToken {
  lineUserId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  used: boolean;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  enrollment_term_id: number;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  course_id: number;
  has_submitted_submissions: boolean;
  submission_types: string[];
}

export interface CanvasSubmission {
  id: number;
  assignment_id: number;
  workflow_state: string;
  submitted_at: string | null;
  grade: string | null;
}

export interface CanvasUser {
  id: number;
  name: string;
  login_id: string;
}
