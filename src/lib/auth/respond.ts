import { NextResponse } from "next/server";
import { AuthError } from "./session";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Réponse JSON avec pose de cookies (plusieurs `Set-Cookie` possibles). */
export function jsonResponse(body: unknown, status = 200, cookies: string[] = []): NextResponse {
  const response = NextResponse.json(body, { status });
  for (const cookie of cookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

export function apiError(code: string, message: string, status: number, details?: unknown): NextResponse {
  const body: ApiErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return jsonResponse(body, status);
}

/** Traduit une AuthError en réponse HTTP. */
export function authErrorResponse(error: AuthError): NextResponse {
  return apiError(error.code, error.message, error.status);
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
