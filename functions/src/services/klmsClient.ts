import {KLMS_BASE_URL} from "../config";
import {
  CanvasCourse,
  CanvasAssignment,
  CanvasSubmission,
  CanvasUser,
} from "../types";

class KlmsApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "KlmsApiError";
  }
}

async function apiRequest<T>(
  endpoint: string,
  token: string
): Promise<T> {
  const url = `${KLMS_BASE_URL}/api/v1${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new KlmsApiError(
      response.status,
      `KLMS API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

async function apiRequestPaginated<T>(
  endpoint: string,
  token: string
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null =
    `${KLMS_BASE_URL}/api/v1${endpoint}`;

  while (url) {
    const currentUrl: string = url;
    const separator = currentUrl.includes("?") ? "&" : "?";
    const fetchUrl: string = currentUrl.includes("per_page")
      ? currentUrl
      : `${currentUrl}${separator}per_page=50`;

    const response: Response = await fetch(fetchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new KlmsApiError(
        response.status,
        `KLMS API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as T[];
    results.push(...data);

    const linkHeader: string | null = response.headers.get("link");
    url = null;
    if (linkHeader) {
      const nextMatch: RegExpMatchArray | null =
        linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }

  return results;
}

export async function verifyToken(token: string): Promise<CanvasUser> {
  return apiRequest<CanvasUser>("/users/self", token);
}

export async function getActiveCourses(
  token: string
): Promise<CanvasCourse[]> {
  return apiRequestPaginated<CanvasCourse>(
    "/courses?enrollment_state=active",
    token
  );
}

export async function getCourseAssignments(
  token: string,
  courseId: number
): Promise<CanvasAssignment[]> {
  return apiRequestPaginated<CanvasAssignment>(
    `/courses/${courseId}/assignments?order_by=due_at`,
    token
  );
}

export async function getSubmission(
  token: string,
  courseId: number,
  assignmentId: number
): Promise<CanvasSubmission> {
  return apiRequest<CanvasSubmission>(
    `/courses/${courseId}/assignments/${assignmentId}/submissions/self`,
    token
  );
}

export async function getUnsubmittedTasks(
  token: string
): Promise<
  Array<{
    course: CanvasCourse;
    assignment: CanvasAssignment;
    submission: CanvasSubmission;
  }>
> {
  const courses = await getActiveCourses(token);
  const results: Array<{
    course: CanvasCourse;
    assignment: CanvasAssignment;
    submission: CanvasSubmission;
  }> = [];

  for (const course of courses) {
    let assignments: CanvasAssignment[];
    try {
      assignments = await getCourseAssignments(token, course.id);
    } catch {
      continue;
    }

    const futureAssignments = assignments.filter((a) => {
      if (!a.due_at) return true;
      return new Date(a.due_at).getTime() > Date.now();
    });

    for (const assignment of futureAssignments) {
      try {
        const submission = await getSubmission(
          token,
          course.id,
          assignment.id
        );
        if (
          submission.workflow_state === "unsubmitted" ||
          (!submission.submitted_at &&
            submission.workflow_state !== "graded")
        ) {
          results.push({course, assignment, submission});
        }
      } catch {
        continue;
      }
    }
  }

  return results;
}

export {KlmsApiError};
