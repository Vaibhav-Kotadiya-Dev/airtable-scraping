import axios, { type AxiosError } from "axios";
import { env } from "../../core/config/env";
import { ApiError } from "../../core/http/errorHandler";

type AirtableMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function airtableApiRequest<T>(
  accessToken: string,
  method: AirtableMethod,
  path: string,
  params?: Record<string, unknown>,
  data?: unknown,
): Promise<T> {
  const url = `${env.airtableApiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const response = await axios.request<T>({
      url,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      params,
      data,
      timeout: 60_000,
    });

    return response.data;
  } catch (err) {
    const axiosErr = err as AxiosError;
    const statusCode = axiosErr.response?.status ?? 502;
    const responseData = axiosErr.response?.data;

    const message = `Airtable API error ${statusCode} for ${method} ${path}`;
    throw new ApiError(message, statusCode, {
      url,
      method,
      path,
      params,
      airtable: responseData,
    });
  }
}

