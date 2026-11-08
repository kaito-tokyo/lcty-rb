// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// <lcty-cmd>: a command tag as a command object (LCTYSP-0003, LCTYSP-0004, LCTYSP-0005). Unlike the elements in
// lcty.v1.cjs (structure only), a command is behavior itself, so it is defined here.
//
//   <lcty-cmd data-op="send" data-at="…"></lcty-cmd>
//
// When a command becomes the last element of <lcty-c>, it runs its operation (data-op) and is responsible for it: while
// running it floats above the composer (slot="float" of <lcty-c>) with a spinner and a stop button, and can be aborted.
// It never scrolls the page. A command is added either
//   - to the file as well (when a conversation is created): opening the conversation again runs it while it is still
//     the last element, so an interrupted creation resumes; or
//   - only in memory (sending, regenerating): it runs now, and nothing is left to resume after the page closes.
// A command followed by other elements (its result) has already run and stays hidden. Unknown operations do nothing.
// The state is an attribute in the DOM only (never saved): running / done / aborted / failed / unknown.
import { tr } from "../i18n.js";

const ops = { __proto__: null }; // op name → async (cmd, controller) => void

/** The class of <lcty-cmd> (created when it is defined, so the module only declares). */
function cmdElementClass() {
	return class LctyCmdElement extends HTMLElement {
		#controller = null;
		#ran = false;

		constructor() {
			super();
			const h = (tag, attrs = {}, ...children) => {
				const el = document.createElement(tag);
				for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
				el.append(...children);
				return el;
			};
			this.label = h(
				"span",
				{ part: "lcty-cmd__label" },
				tr("generating", "Generating…"),
			);
			this.stopButton = h(
				"button",
				{ type: "button", part: "lcty-cmd__stop lcty-button" },
				tr("stop", "Stop"),
			);
			this.stopButton.onclick = () => this.abort();
			this.attachShadow({ mode: "open" }).append(
				h(
					"div",
					{ class: "cmd-box", part: "lcty-cmd__box" },
					h("span", { class: "spinner", part: "lcty-cmd__spinner" }),
					this.label,
					this.stopButton,
				),
			);
		}

		connectedCallback() {
			if (this.#ran) return;
			const parent = this.parentElement;
			if (parent?.localName !== "lcty-c" || parent.lastElementChild !== this) {
				this.setAttribute("state", "done"); // already followed by its result
				return;
			}
			this.run();
		}

		/** Run the operation (once). Resolves when it has finished, been aborted or failed. */
		async run() {
			if (this.#ran) return; // running, or already run: a command runs once
			const op = ops[this.dataset.op];
			if (!op) {
				this.setAttribute("state", "unknown");
				return;
			}
			this.#ran = true;
			this.#controller = new AbortController();
			this.setAttribute("state", "running");
			this.slot = "float";
			try {
				await op(this, this.#controller);
				this.setAttribute(
					"state",
					this.#controller.signal.aborted ? "aborted" : "done",
				);
			} catch (e) {
				this.setAttribute("state", "failed");
				console.error(`lcty-cmd ${this.dataset.op} failed`, e);
			} finally {
				this.#controller = null;
				this.removeAttribute("slot");
			}
		}

		/** Abort the running operation (no-op when it is not running). */
		abort() {
			this.#controller?.abort();
		}
	};
}

/**
 * Register the operations and define <lcty-cmd>. Call it once the page is ready to run them: commands already in the
 * document are upgraded at this moment, and the last one runs.
 * @param {Record<string, (cmd: HTMLElement, controller: AbortController) => Promise<void>>} table
 */
export function defineCommands(table) {
	for (const [name, op] of Object.entries(table)) ops[name] = op;
	if (!customElements.get("lcty-cmd"))
		customElements.define("lcty-cmd", cmdElementClass());
}

/** Add a command in memory only (not to the file) at the end of container; it runs at once. */
export function appendCommand(container, op) {
	const cmd = document.createElement("lcty-cmd");
	cmd.dataset.op = op;
	cmd.dataset.at = new Date().toISOString();
	container.append(cmd);
	return cmd;
}
