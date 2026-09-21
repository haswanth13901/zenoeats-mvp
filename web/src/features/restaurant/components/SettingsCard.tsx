import type { ReactNode } from "react";
import { SettingsHeading } from "@/components/common/Feedback";

export function SettingsCard({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card mb-6 scroll-mt-6" aria-labelledby={`${id}-heading`}>
      <SettingsHeading id={`${id}-heading`} title={title} subtitle={subtitle} />
      <div className="mt-6">{children}</div>
    </section>
  );
}

