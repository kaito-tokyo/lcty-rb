// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1024: the scenarios of docs/specs/LCTYSP-1024_tab-rpc.feature, written by hand. Each test has the title of its
// Scenario and one step per line of it, the Background first, so the two read side by side.
//
// js/api/tab-rpc.js runs in Node.js (node-unit.js); every scenario imports it anew (a query string makes it a new
// module), since it keeps the tab's one connection. The WebSocket is a fake that records what the client sends and is
// opened, answered and closed by the test, and the timer a fake that runs a callback only when the test says so.

import { expect, publicUrl, scenario } from "./node-unit.js";

let loaded = 0;

/** A fake WebSocket and timer, as in rpc.test.js. */
function fakes() {
	const sockets = [];
	const timers = [];
	class FakeSocket {
		constructor(url) {
			this.url = url;
			this.sent = [];
			this.closed = false;
			sockets.push(this);
		}
		send(text) {
			this.sent.push(JSON.parse(text));
		}
		close() {
			if (this.closed) return;
			this.closed = true;
			this.onclose?.();
		}
		open() {
			this.onopen?.();
		}
		receive(msg) {
			this.onmessage?.({ data: JSON.stringify(msg) });
		}
	}
	const setTimeoutImpl = (fn, ms) => timers.push({ fn, ms });
	return { sockets, timers, FakeSocket, setTimeoutImpl };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function answerInitialize(socket) {
	await settle();
	const req = socket.sent.findLast((m) => m.method === "initialize");
	socket.receive({
		jsonrpc: "2.0",
		id: req.id,
		result: { actorId: "actor-1" },
	});
	await settle();
}

async function background(step) {
	const f = fakes();
	await step(
		"Given the module, with a fake WebSocket and a fake timer for tabRpc()",
		async () => {
			loaded += 1;
			f.mod = await import(`${publicUrl("js/api/tab-rpc.js")}?n=${loaded}`);
			f.open = () =>
				f.mod.tabRpc({
					url: "ws://lcty.test/v1/rpc",
					WebSocketImpl: f.FakeSocket,
					setTimeoutImpl: f.setTimeoutImpl,
				});
		},
	);
	return f;
}

async function opened(f) {
	const rpc = f.open();
	f.sockets.at(-1).open();
	await answerInitialize(f.sockets.at(-1));
	return rpc;
}

scenario(
	"The connection declares what every part registered",
	async ({ step }) => {
		const f = await background(step);
		await step(
			'Given two listeners of "c.batch.updated", one of "t.batch.updated" and an answer to "c.cmd.holds" are registered',
			() => {
				f.mod.onTabNotify("c.batch.updated", () => {});
				f.mod.onTabNotify("c.batch.updated", () => {});
				f.mod.onTabNotify("t.batch.updated", () => {});
				f.mod.onTabRequest("c.cmd.holds", () => ({ holds: false }));
			},
		);
		await step("When tabRpc() is called and the socket opens", () => {
			f.open();
			f.sockets[0].open();
		});
		await step(
			'Then initialize declares the receives "c.batch.updated", "t.batch.updated" and "c.cmd.holds"',
			() => {
				expect(f.sockets[0].sent[0].params).toEqual({
					capabilities: {
						receives: ["c.batch.updated", "t.batch.updated", "c.cmd.holds"],
					},
				});
			},
		);
	},
);

scenario(
	"A notification goes to every listener, whatever one throws",
	async ({ step }) => {
		const f = await background(step);
		const got = [];
		const warnings = [];
		const warn = console.warn;
		await step(
			'Given a listener of "c.batch.updated" that throws and a second one are registered',
			() => {
				f.mod.onTabNotify("c.batch.updated", () => {
					throw new Error("listener broke");
				});
				f.mod.onTabNotify("c.batch.updated", (p) => got.push(p));
			},
		);
		await step("And the connection is open", () => opened(f));
		try {
			console.warn = (...args) => warnings.push(args);
			await step("When the server sends c.batch.updated", () =>
				f.sockets[0].receive({
					jsonrpc: "2.0",
					method: "c.batch.updated",
					params: { version: "b1.2", actorId: null, records: [] },
				}),
			);
		} finally {
			console.warn = warn;
		}
		await step("Then the second listener gets its params", () => {
			expect(got).toEqual([{ version: "b1.2", actorId: null, records: [] }]);
		});
		await step("And the error of the first is logged as a warning", () => {
			expect(warnings.map((w) => w[0]?.message)).toEqual(["listener broke"]);
		});
	},
);

scenario(
	"Every open listener gets the connection, again after reconnecting",
	async ({ step }) => {
		const f = await background(step);
		const calls = [];
		let rpc;
		await step(
			"Given a listener of the connection's opening is registered",
			() => f.mod.onTabOpen((r) => calls.push(r)),
		);
		await step("When the connection opens", async () => {
			rpc = await opened(f);
		});
		await step(
			"Then the listener has been called once with the connection",
			() => {
				expect(calls).toHaveLength(1);
				expect(calls[0]).toBe(rpc);
			},
		);
		await step(
			"When the socket closes and the client opens a new one",
			async () => {
				f.sockets[0].close();
				f.timers.shift().fn();
				f.sockets[1].open();
				await answerInitialize(f.sockets[1]);
			},
		);
		await step(
			"Then the listener has been called twice with the connection",
			() => {
				expect(calls).toHaveLength(2);
				expect(calls[1]).toBe(rpc);
			},
		);
	},
);

scenario("tabRpc() returns the one connection of the tab", async ({ step }) => {
	const f = await background(step);
	let first;
	let second;
	await step("When tabRpc() is called twice", () => {
		first = f.open();
		second = f.open();
	});
	await step(
		"Then both calls return the same connection, on one socket",
		() => {
			expect(second).toBe(first);
			expect(f.sockets).toHaveLength(1);
		},
	);
});

scenario(
	"Registering after the connection is open is refused",
	async ({ step }) => {
		const f = await background(step);
		await step("Given tabRpc() has been called", () => f.open());
		await step(
			`Then onTabNotify, onTabRequest and onTabOpen each throw "the tab's connection is already open"`,
			() => {
				const message = "the tab's connection is already open";
				expect(() => f.mod.onTabNotify("c.batch.updated", () => {})).toThrow(
					message,
				);
				expect(() => f.mod.onTabRequest("c.cmd.holds", () => {})).toThrow(
					message,
				);
				expect(() => f.mod.onTabOpen(() => {})).toThrow(message);
			},
		);
	},
);
