/**
 * The foot of every customer page.
 *
 * Two jobs, and neither is decoration.
 *
 * The allergen line. Zenoeats does not cook the food, does not inspect the
 * kitchen and cannot verify an ingredient list, so the only honest thing to
 * say is "ask the restaurant" -- and it has to be said where someone about to
 * order will see it, not only inside a policy they will not open.
 *
 * The policy links. Google, Apple and Facebook all require a reachable
 * privacy policy before they will approve sign-in, and Facebook requires the
 * deletion page as well. They are plain <a> elements rather than <Link>
 * because the pages are files served outside this app, so React Router must
 * not try to resolve them.
 */
export function CustomerFooter() {
  return (
    <footer className="mt-16 border-t border-hairline px-4 py-8 text-caption text-muted sm:px-6">
      <div className="mx-auto max-w-[1100px] space-y-3">
        <p>
          Allergies or intolerances? Food is prepared in kitchens that handle
          allergens, and cross-contact cannot be ruled out. Contact the
          restaurant before ordering.
        </p>
        <nav className="legal-links" aria-label="Policies">
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/refunds">Refunds</a>
          <a href="/legal/data-deletion">Your data</a>
        </nav>
        <p>Ordering by Zenoeats.</p>
      </div>
    </footer>
  );
}
