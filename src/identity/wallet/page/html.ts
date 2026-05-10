export const glyphs = {
  eyes: `
                                         -+:
                   :=-                    -%@@@%.
             *@@@@@#-                           *@@-
          +@@.                                     +@
        @@=                               -#=-+++=+:
      #%        .:===-:                   -@* +@@@@%
           *@-+@@@@@:                    %@@+  @@@=#@
          *@=   @@@@@@@-                .@.@@@@@@@ :
        @@+=@@@@@@@@@@@@:               .% *@@@@@*-=
       #:-@ -@@@@@@@@@-+%                @  -@@@- #
       :  #+  @@@@@@@- -%                 =#     =
           -@:        *@                      .+%%
              :%#: --
              .-:
                                                           `,
  ellipsis: "…",
};

export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
export function renderEyes(): string { return escapeHtml(glyphs.eyes); }
