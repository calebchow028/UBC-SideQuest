<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Shared Screen owns responsive website framing and the client-only session gate; mark only sign-in and sign-up public so every member page is guarded consistently without changing the demo authentication architecture.
- Background rendering and logo styling live in global CSS; per-page imported campus illustrations share one cartoon art direction to keep visual treatment consistent.
- CampusIllustration shares imported artwork between menu links and page headers so both use the same images; Screen contains each scene without width-driven cropping.
- GameModeProvider wraps the root outlet so every page shares activeGameMode; browser storage is read after hydration to keep SSR stable.
- Screen surrounds each contained campus scene with one shared transparent frame asset, preserving artwork aspect ratios without width-driven cropping.
- The manual quest flow uses separate queue, assignment, and map routes with shared Home navigation; prototype values live in one browser-safe module so future matchmaking can replace them without changing authentication.
