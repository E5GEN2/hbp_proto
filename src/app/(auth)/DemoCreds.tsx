// Demo credentials — moved out of the auth card into an unobtrusive fixed card in the
// bottom-right corner so they don't compete with the form design. Hidden on small screens.
export function DemoCreds() {
  return (
    <aside className="demo-creds-fixed" aria-label="Demo credentials">
      <div className="demo-creds-title">Demo credentials</div>
      <div className="demo-creds-group">
        <span className="demo-creds-kind">Clients</span>
        <span className="demo-creds-pass">pass <code>demo1234</code></span>
      </div>
      <div className="demo-creds-list">demo@example.com · jordan@example.com · yuki@example.com</div>
      <div className="demo-creds-group">
        <span className="demo-creds-kind">Admins</span>
        <span className="demo-creds-pass">pass <code>admin1234</code></span>
      </div>
      <div className="demo-creds-list">admin@hbp.local · ops@hbp.local · support@hbp.local</div>
    </aside>
  );
}
