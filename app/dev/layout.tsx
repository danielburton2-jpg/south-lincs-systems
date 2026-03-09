import DevSidebar from "@/components/devSidebar";
import "@/styles/dev-layout.css";

export default function DevLayout({ children }: { children: React.ReactNode }) {

  return (

    <div className="dev-layout">

      <DevSidebar />

      <main className="dev-content">
        {children}
      </main>

    </div>

  );

}