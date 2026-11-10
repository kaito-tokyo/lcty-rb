// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1022: the scenarios of docs/specs/LCTYSP-1022_rpc-client.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one step per line of it, the Background first, so the two
// read side by side.
//
// js/api/rpc.js runs in Node.js (node-unit.js) on a fake WebSocket, which records what the client sends and is opened,
// answered and closed by the test, and a fake timer, which records the delays it is given and runs a callback only
// when the test says so. Nothing reaches a server.

import { expect, publicUrl, scenario } from "./node-unit.js";

const { connectRpc, RpcError } = await import(publicUrl("js/api/rpc.js"));

/** A fake WebSocket: every one made is in sockets; sent holds the messages sent, parsed. */
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
		// What the server does
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

/** Let the client's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Answer the last request of a socket (the one with the highest id) with a result. */
async function answerLast(socket, result) {
	await settle();
	const req = socket.sent.findLast((m) => "method" in m && "id" in m);
	socket.receive({ jsonrpc: "2.0", id: req.id, result });
	await settle();
}

async function background(step) {
	const f = fakes();
	f.opened = 0;
	f.notes = [];
	f.holds = (params) => ({ holds: params.id === "cmd-1" });
	await step(
		'Given connectRpc with the notification "c.batch.updated", the request "c.cmd.holds" and onOpen, on a fake WebSocket and a fake timer',
		() => {
			f.rpc = connectRpc({
				url: "ws://lcty.test/v1/rpc",
				onNotify: { "c.batch.updated": (p) => f.notes.push(p) },
				onRequest: { "c.cmd.holds": (p) => f.holds(p) },
				onOpen: () => {
					f.opened += 1;
				},
				WebSocketImpl: f.FakeSocket,
				setTimeoutImpl: f.setTimeoutImpl,
			});
		},
	);
	return f;
}

async function givenOpen(
	step,
	f,
	line = "Given the socket is open and initialized",
) {
	await step(line, async () => {
		f.sockets[0].open();
		await answerLast(f.sockets[0], { actorId: "actor-1" });
	});
}

scenario(
	"The client sends initialize with the methods it receives, then calls onOpen",
	async ({ step }) => {
		const f = await background(step);
		await step("When the socket opens", () => f.sockets[0].open());
		await step(
			'Then the first message is initialize with the receives "c.batch.updated" and "c.cmd.holds"',
			() => {
				expect(f.sockets[0].sent[0]).toEqual({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						capabilities: { receives: ["c.batch.updated", "c.cmd.holds"] },
					},
				});
			},
		);
		await step('When initialize answers the actorId "actor-1"', () =>
			answerLast(f.sockets[0], { actorId: "actor-1" }),
		);
		await step(
			'Then onOpen has been called once and the client\'s actorId is "actor-1"',
			() => {
				expect(f.opened).toBe(1);
				expect(f.rpc.actorId).toBe("actor-1");
			},
		);
	},
);

scenario(
	"A request sent before initialize has answered waits for it",
	async ({ step }) => {
		const f = await background(step);
		let pending;
		await step("When c.list is called before the socket opens", () => {
			pending = f.rpc.call("c.list", { a: 1 });
		});
		await step("And the socket opens and initialize answers", async () => {
			f.sockets[0].open();
			await answerLast(f.sockets[0], { actorId: "actor-1" });
		});
		await step(
			"Then the second message is the request c.list with its params",
			async () => {
				await settle();
				expect(f.sockets[0].sent[1]).toEqual({
					jsonrpc: "2.0",
					id: 2,
					method: "c.list",
					params: { a: 1 },
				});
				await answerLast(f.sockets[0], { items: [] });
				await pending;
			},
		);
	},
);

scenario(
	"A result resolves the call, and an error rejects it with an RpcError",
	async ({ step }) => {
		const f = await background(step);
		await givenOpen(step, f);
		let ok;
		let bad;
		await step(
			"When c.list is called and answered with a result, and c.unappend is called and answered with the error 1 and data",
			async () => {
				ok = f.rpc.call("c.list");
				await answerLast(f.sockets[0], { items: ["x"] });
				bad = f.rpc.call("c.unappend", { cid: "c" });
				await settle();
				const req = f.sockets[0].sent.at(-1);
				f.sockets[0].receive({
					jsonrpc: "2.0",
					id: req.id,
					error: { code: 1, message: "conflict", data: { last: "msg-u-1" } },
				});
			},
		);
		await step("Then the first call resolves to the result", async () => {
			expect(await ok).toEqual({ items: ["x"] });
		});
		await step(
			"And the second rejects with an RpcError of the code 1, the message and the data",
			async () => {
				const e = await bad.catch((e) => e);
				expect(e).toBeInstanceOf(RpcError);
				expect([e.code, e.message, e.data]).toEqual([
					1,
					"conflict",
					{ last: "msg-u-1" },
				]);
			},
		);
	},
);

scenario(
	"A notification goes to its handler, and one not received is ignored",
	async ({ step }) => {
		const f = await background(step);
		await givenOpen(step, f);
		const before = f.sockets[0].sent.length;
		await step("When the server sends c.batch.updated and then c.other", () => {
			f.sockets[0].receive({
				jsonrpc: "2.0",
				method: "c.batch.updated",
				params: { version: "b.1" },
			});
			f.sockets[0].receive({ jsonrpc: "2.0", method: "c.other", params: {} });
		});
		await step(
			"Then the handler of c.batch.updated has been given its params once",
			() => {
				expect(f.notes).toEqual([{ version: "b.1" }]);
			},
		);
		await step("And nothing is sent back", async () => {
			await settle();
			expect(f.sockets[0].sent).toHaveLength(before);
		});
	},
);

for (const [method, answer, setUp, expected] of [
	[
		"c.cmd.holds",
		"the result of its handler",
		() => {},
		{ result: { holds: true } },
	],
	[
		"c.cmd.holds throwing",
		"an error of the code -32603 and its text",
		(f) => {
			f.holds = () => {
				throw new Error("boom");
			};
		},
		{ error: { code: -32603, message: "boom" } },
	],
	[
		"c.unknown",
		"an error of the code -32603",
		() => {},
		{ error: { code: -32603, message: "not received: c.unknown" } },
	],
]) {
	scenario(
		`A request of the server is answered (${method})`,
		async ({ step }) => {
			const f = await background(step);
			await givenOpen(step, f);
			await step(`When the server sends the request ${method}`, async () => {
				setUp(f);
				f.sockets[0].receive({
					jsonrpc: "2.0",
					id: "s1",
					method: method.split(" ")[0],
					params: { cid: "c", id: "cmd-1" },
				});
				await settle();
			});
			await step(`Then the client answers it with ${answer}`, () => {
				expect(f.sockets[0].sent.at(-1)).toEqual({
					jsonrpc: "2.0",
					id: "s1",
					...expected,
				});
			});
		},
	);
}

scenario(
	"A lost connection rejects the waiting calls and opens a new socket, waiting longer each time",
	async ({ step }) => {
		const f = await background(step);
		let waiting;
		await givenOpen(
			step,
			f,
			"Given the socket is open and initialized, and c.list is waiting for its answer",
		);
		waiting = f.rpc.call("c.list").catch((e) => e);
		await settle();
		await step("When the socket closes", () => f.sockets[0].close());
		await step(
			"Then the call rejects because the connection was lost",
			async () => {
				expect((await waiting).message).toBe("the connection was lost");
			},
		);
		await step("And a new socket is opened after 1000 ms", () => {
			expect(f.timers.map((t) => t.ms)).toEqual([1000]);
			f.timers[0].fn();
			expect(f.sockets).toHaveLength(2);
		});
		await step("When that socket closes before it opens", () =>
			f.sockets[1].close(),
		);
		await step("Then the next one is opened after 2000 ms", () => {
			expect(f.timers.map((t) => t.ms)).toEqual([1000, 2000]);
			f.timers[1].fn();
			expect(f.sockets).toHaveLength(3);
		});
		await step("When it opens and initialize answers", async () => {
			f.sockets[2].open();
			await answerLast(f.sockets[2], { actorId: "actor-2" });
		});
		await step("Then onOpen has been called again", () => {
			expect(f.opened).toBe(2);
			expect(f.rpc.actorId).toBe("actor-2");
		});
	},
);

scenario("close() closes the socket and opens no other", async ({ step }) => {
	const f = await background(step);
	await givenOpen(step, f);
	await step("When close() is called", () => f.rpc.close());
	await step(
		"Then the socket is closed, no new socket is waited for, and a call rejects",
		async () => {
			expect(f.sockets[0].closed).toBe(true);
			expect(f.timers).toHaveLength(0);
			await expect(f.rpc.call("c.list")).rejects.toThrow(
				"the connection is closed",
			);
		},
	);
});
