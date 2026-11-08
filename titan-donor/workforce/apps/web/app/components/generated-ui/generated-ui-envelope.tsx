import { ArrowRight, CalendarDays, CircleDollarSign, ShieldAlert, Sparkles } from "lucide-react";
import { selectHighestValueCards, validatePresentationIntent, type GeneratedUiCardIntent, type PresentationIntentEnvelope } from "../../runtime/presentation-intent";

function iconFor(kind: GeneratedUiCardIntent["kind"]) {
  if (kind === "schedule" || kind === "service") return <CalendarDays />;
  if (kind === "payment") return <CircleDollarSign />;
  if (kind === "recovery") return <ShieldAlert />;
  return <Sparkles />;
}

export function GeneratedUiEnvelope({ intent, expected }: { intent: PresentationIntentEnvelope; expected: Pick<PresentationIntentEnvelope, "company_id" | "conversation_id" | "surface"> }) {
  let cards: GeneratedUiCardIntent[];
  try { cards = selectHighestValueCards(validatePresentationIntent(intent, expected)); }
  catch { return <p className="generated-ui-fallback" role="status">Structured view unavailable. Continue in conversation.</p>; }
  return <section className="generated-ui-envelope" aria-label="Contextual workspace" aria-live="polite">
    {cards.map((card) => <article className={`gen-card generated-${card.kind}-card`} key={card.id} data-presentation-card={card.kind} tabIndex={0} aria-describedby={`${card.id}-fallback`}>
      <header><span className="gen-icon">{iconFor(card.kind)}</span><div><small>{intent.purpose}</small><h3>{card.title}</h3><p>{card.summary}</p></div></header>
      {!!card.facts?.length && <div className="gen-facts">{card.facts.slice(0, 3).map((fact) => <span key={`${card.id}-${fact.label}`}><strong>{fact.value}</strong>{fact.label}</span>)}</div>}
      {!!card.actions?.length && <div className="gen-actions">{card.actions.slice(0, 2).map((action, index) => <button key={action.id} className={index === card.actions!.length - 1 ? "primary" : undefined} data-action-mode={action.mode}>{action.label}{index === card.actions!.length - 1 && <ArrowRight />}</button>)}</div>}
      <span className="sr-only" id={`${card.id}-fallback`}>{card.text_fallback}</span>
    </article>)}
  </section>;
}
