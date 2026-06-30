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
      <div className="demo-creds-list">
        <div>demo@example.com</div>
        <div>jordan@example.com</div>
        <div>yuki@example.com</div>
      </div>
      <div className="demo-creds-group">
        <span className="demo-creds-kind">Admins</span>
        <span className="demo-creds-pass">pass <code>admin1234</code></span>
      </div>
      <div className="demo-creds-list">
        <div>admin@hbp.local</div>
        <div>ops@hbp.local</div>
        <div>support@hbp.local</div>
      </div>
    </aside>
  );
}
