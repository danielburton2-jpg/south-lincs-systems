export default function DevDashboardPage() {
  return (
    <div className="dev-dashboard-page">
      <div className="dev-page-header">
        <div>
          <h1 className="dev-page-title">Dev Dashboard</h1>
          <p className="dev-page-subtitle">
            Welcome to South Lincs Systems development control panel.
          </p>
        </div>
      </div>

      <section className="dev-card-grid">
        <div className="dev-card">
          <h2 className="dev-card-title">Dashboard</h2>
          <p className="dev-card-text">
            This is the main development dashboard. Use the sidebar to move
            through each module as we build the system step-by-step.
          </p>
        </div>

        <div className="dev-card">
          <h2 className="dev-card-title">Superusers</h2>
          <p className="dev-card-text">
            Superuser management will be created next after audit logging is
            ready.
          </p>
        </div>

        <div className="dev-card">
          <h2 className="dev-card-title">Companies</h2>
          <p className="dev-card-text">
            Company management will be added after the Superusers module is in
            place.
          </p>
        </div>

        <div className="dev-card">
          <h2 className="dev-card-title">Audit Log</h2>
          <p className="dev-card-text">
            Global audit logging will be connected in the next step so every
            important action is recorded automatically.
          </p>
        </div>
      </section>
    </div>
  );
}