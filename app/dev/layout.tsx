import "@/styles/dev.css";
import "@/styles/buttons.css";
import "@/styles/forms.css";
import "@/styles/tables.css";
import DevSidebar from "@/components/devSidebar";
import { ReactNode } from "react";

export default function DevLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dev-shell">
      <aside className="dev-sidebar-wrap">
        <DevSidebar />
      </aside>

      <main className="dev-main">
        <div className="dev-page-container">{children}</div>
      </main>
    </div>
  );
}