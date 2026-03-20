# Open questions

Lock these before wide implementation to reduce screen churn:

1. **Multiline submit key:** Ctrl+D only, or also F10? Pick one primary, document it everywhere.
2. **Stream cancel:** First Esc aborts in-flight request; second Esc navigates back (recommended). Confirm and document in footer.
3. **Profile save discipline:** Hold-then-confirm-on-navigate, or immediate-per-field? Pick one and apply consistently across editor screens.
4. **Profile breadcrumb:** In Header, or inside ContentArea? (Recommend: ContentArea — Header already has profile info.)
5. **React/Ink peer versions:** Pin at install time; resolve before first commit with Ink.
6. **Settings — save on failed probe:** If API key validation fails, block save vs allow "Save anyway" with warning — pick one.
7. **Per-screen letter shortcuts vs text fields:** When Jobs uses `a`/`d`/`g`/`p`, confirm no conflict with command palette or search — document resolution.
