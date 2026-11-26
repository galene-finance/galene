# Settings presentation increment

Local source only, not deployed. The Settings hub now uses shared grouped rows instead of independent cards, retains every native destination, and preserves admin/demo visibility, search and recoverable empty state. No native settings action or authorization handler changed.

Appearance now uses the existing tested presentation-order helper: Graphite, Ocean, Dark lead, with other/custom choices retained. Canonical DEFAULT_THEMES order and selected/saved preferences are not mutated. Browser RED evidence showed Light/Dark/Forest first; corrected native route passes the preferred order.

Eight synthetic phone/desktop/theme layout cases are recorded in product-v3-settings/checks.json, with final contact sheets inspected. An observed excessive desktop icon/title gap was reproduced (444.8px) and corrected to 16px; affected frames refreshed. Browser checks cover search-empty-clear and nonadmin/demo visibility. No save, publish, credential or real-data operation was attempted. Persistence/authenticated acceptance and full subpage/state coverage remain open.

Final suite 317 pass / 0 fail / 1218 expectations; compiler0/0. Exact postcommit test/build execution fingerprints recorded separately in task evidence. Expanded target/allocation/history scope now explicitly supersedes legacy exclusions in the system sheet; W16 contract remains on its isolated branch, not integrated. W11 did not edit any W16-owned path.
