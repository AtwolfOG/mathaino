export function navigateAfterAuthentication(
  destination: "/practice" | "/login" | "/login?registered=1",
) {
  // A full navigation discards private in-memory UI state when identity changes.
  window.location.replace(destination);
}
