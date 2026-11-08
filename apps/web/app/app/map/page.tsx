import Link from "next/link";
import { DayMapPanel } from "../DayMapPanel";

export default function MapPage() {
  return <div className="tf-reference-ui tf-workspace tf-dispatch-page">
    <div className="tf-topline"><span className="tf-zero-orb"/><span>Zero <b className="tf-green">• Ready</b></span></div>
    <div className="tf-heading"><h1>Dispatch map</h1><Link href="/app/schedule">Open dispatch →</Link></div>
    <nav className="tf-tabs" aria-label="Map workspaces"><span className="tf-tab tf-tab-active">Dispatch</span><Link className="tf-tab" href="/app/properties">Zones</Link><Link className="tf-tab" href="/app/timeline">Routes</Link><Link className="tf-tab" href="/app/assets">Assets</Link></nav>
    <section className="tf-dispatch-map" aria-label="Recorded field stops and routes"><DayMapPanel height={570} /></section>
    <section className="tf-new-panel"><h2>Field operations</h2><p>The map displays recorded stop coordinates and route geometry from the existing activity API. It does not imply live crew tracking. Select a stop for its recorded label; use the links below for dispatch decisions.</p><div className="tf-action-grid"><Link href="/app/schedule">Dispatch schedule →</Link><Link href="/app/workforce">Crews and resources →</Link><Link href="/app/timeline">Tracking and history →</Link><Link href="/app/properties">Service locations →</Link></div></section>
  </div>;
}
