let csrfToken: string | null = null

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function setCsrfToken(nextToken: string | null): void {
  csrfToken = nextToken
}

export function clearCsrfToken(): void {
  csrfToken = null
}

function isMutation(method: string | undefined): boolean {
  if (!method) {
    return false
  }
  const upper = method.toUpperCase()
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE'
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
  skipCsrf?: boolean
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  headers.set('Accept', 'application/json')

  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData

  if (options.body !== undefined && !isFormDataBody) {
    headers.set('Content-Type', 'application/json')
  }

  if (isMutation(options.method) && !options.skipCsrf) {
    if (!csrfToken) {
      throw new ApiError('sessao csrf nao inicializada', 403)
    }
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(path, {
    ...options,
    body:
      options.body === undefined
        ? undefined
        : isFormDataBody
          ? options.body as FormData
          : JSON.stringify(options.body),
    headers,
    credentials: 'include',
  })

  let payload: unknown = {}
  const text = await response.text()
  if (text.trim()) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError('resposta invalida do servidor', response.status)
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `falha na requisicao (${response.status})`
    throw new ApiError(message, response.status)
  }

  return payload as T
}
