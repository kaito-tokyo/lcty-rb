// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// <lcty-cmd>: a command tag as a command object that runs its operation (LCTYSP-0003, LCTYSP-0004, LCTYSP-0005).
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
			this.retryButton = h(
				"button",
				{ type: "button", part: "lcty-cmd__retry lcty-button" },
				tr("retry", "Retry"),
			);
			this.removeButton = h(
				"button",
				{ type: "button", part: "lcty-cmd__remove lcty-button" },
				tr("remove", "Remove"),
			);
			this.attachShadow({ mode: "open" }).append(
				h(
					"div",
					{ class: "cmd-box", part: "lcty-cmd__box" },
					h("span", { class: "spinner", part: "lcty-cmd__spinner" }),
					this.label,
					this.stopButton,
					this.retryButton,
					this.removeButton,
				),
			);
		}

		connectedCallback() {
			if (this.#ran || this.hasAttribute("state")) return;
			if (this.hasAttribute("data-error")) {
				this.setAttribute("state", "failed");
				this.label.textContent = tr("cmdFailed", "Stopped: {error}", {
					error: this.dataset.error,
				});
				return;
			}
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

/** Register the operations and define <lcty-cmd>. */
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
