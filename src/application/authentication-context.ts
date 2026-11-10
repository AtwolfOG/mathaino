// Implement at the trusted server boundary using verified authentication.
// Never populate this context from a caller-supplied owner/user ID.
export interface AuthenticationContext {
  getUserId(): Promise<string | null>;
}
