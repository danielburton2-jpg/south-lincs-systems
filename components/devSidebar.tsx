"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DevSidebar() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <div className="dev-sidebar">

      <div className="dev-sidebar-header">
        <h2>South Lincs Systems</h2>
        <span>DEV PANEL</span>
      </div>

      <nav className="dev-sidebar-nav">

        <Link
          href="/dev/dashboard"
          className={`dev-sidebar-link ${isActive("/dev/dashboard") ? "active" : ""}`}
        >
          Dashboard
        </Link>

        <Link
          href="/dev/superusers"
          className={`dev-sidebar-link ${isActive("/dev/superusers") ? "active" : ""}`}
        >
          Superusers
        </Link>

        <Link
          href="/dev/companies"
          className={`dev-sidebar-link ${isActive("/dev/companies") ? "active" : ""}`}
        >
          Companies
        </Link>

        <Link
  href="/dev/audit"
  className={`dev-sidebar-link ${isActive("/dev/audit") ? "active" : ""}`}
>
  Audit Log
</Link>

      </nav>

      <div className="dev-sidebar-footer">
        <Link href="/login" className="dev-sidebar-logout">
          Logout
        </Link>
      </div>

    </div>
  );
}