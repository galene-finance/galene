/**
 * Copy text to the clipboard. Tries the async Clipboard API first (available
 * in secure contexts only) and falls back to a temporary <textarea> +
 * document.execCommand('copy') for insecure contexts like http://host:5173,
 * where the Clipboard API is absent or rejects. Returns true only when the
 * text actually made it to the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Insecure context or permission denied — fall through.
		}
	}
	try {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(textarea);
		return ok;
	} catch {
		return false;
	}
}
