import { StatePage } from "@/components/common/Feedback";
import { Cloche } from "@/components/common/icons";

/** Its own file so the portal areas can show it without importing the route
 *  table, which imports them. */
export function NotFound() {
  return <StatePage title="Page not found" illustration={<Cloche />} />;
}
