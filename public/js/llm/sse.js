// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// Server-Sent Events parser: a fetch ReadableStream to a sequence of {event, data}.

export async function* parseSSE(body) {
	const reader = body.pipeThrough(new TextDecoderStream()).getReader();
	let buf = "";
	let event = "";
	let data = [];
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += value;
			let start = 0;
			for (
				let nl = buf.indexOf("\n", start);
				nl >= 0;
				nl = buf.indexOf("\n", start)
			) {
				let line = buf.slice(start, nl);
				start = nl + 1;
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (line === "") {
					if (data.length)
						yield { event: event || "message", data: data.join("\n") };
					event = "";
					data = [];
					continue;
				}
				if (line.startsWith(":")) continue;
				const c = line.indexOf(":");
				const field = c < 0 ? line : line.slice(0, c);
				let v = c < 0 ? "" : line.slice(c + 1);
				if (v.startsWith(" ")) v = v.slice(1);
				if (field === "event") event = v;
				else if (field === "data") data.push(v);
			}
			buf = buf.slice(start);
		}
		if (data.length) yield { event: event || "message", data: data.join("\n") };
	} finally {
		reader.releaseLock();
	}
}
