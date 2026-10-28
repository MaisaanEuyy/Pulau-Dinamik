/**
 * Windows toast mirroring: the island reads the notification centre through the
 * WinRT `UserNotificationListener` and pushes each toast into the same list the
 * local HTTP API feeds (see `main/services/toasts.ps1`).
 *
 * Windows gates the listener behind a per-app consent. `allowed` means we may
 * read the notification centre; `denied` means the user has to turn it on in
 * Settings → Privacy & security → Notifications.
 */
export type ToastAccess = 'unknown' | 'allowed' | 'denied'