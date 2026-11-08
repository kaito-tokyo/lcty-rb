// SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
//
// SPDX-License-Identifier: Apache-2.0

// LCTYSP-1020: the scenarios of docs/specs/LCTYSP-1020_tag-names.feature, written by hand. Each test has the title of
// its Scenario (an Examples row is added in parentheses) and one step per line of it, so the two read side by side.
//
// js/tag-names.js has no imports and needs no browser: it runs in Node.js (node-unit.js). The names of the steps
// ("a" U+00A0 "b", 40 times "𝒳") are turned into strings by text(), so an Examples row is written once.

import { expect, publicUrl, scenario } from "./node-unit.js";

const N = await import(publicUrl("js/tag-names.js"));

/**
 * The string a step writes: quoted strings and U+XXXX code points joined, or `<n> times <that>` repeated. The quoted
 * strings hold no double quote (U+0022 is written instead).
 */
function text(shown) {
	const times = shown.match(/^(\d+) times (.*)$/);
	if (times) return text(times[2]).repeat(Number(times[1]));
	let s = "";
	for (const m of shown.matchAll(/"([^"]*)"|U\+([0-9A-F]{4,6})/g))
		s += m[1] ?? String.fromCodePoint(Number.parseInt(m[2], 16));
	return s;
}

/** The definitions "a", "b", … of the feature: the tag files 00010-a.html, 00020-b.html, … named a, b, … */
const defsOf = (...names) =>
	names.map((name, i) => ({
		file: N.tagFileName((i + 1) * 10, name),
		name,
		ops: [],
		prompt: "",
		memory: [],
	}));

/** A tag of the editor: its file (null for a new tag) and name. */
const tag = (file, name, rest = {}) => ({
	file,
	name,
	ops: [],
	prompt: "",
	memory: [],
	...rest,
});

const files = (tags) => tags.map((t) => t.file);

// ---- tagNameError ----

scenario("The longest display name is 40 code points", async ({ step }) => {
	await step("Then TAG_NAME_MAX is 40", () => {
		expect(N.TAG_NAME_MAX).toBe(40);
	});
});

for (const [title, result, rows] of [
	[
		"A display name that can be used",
		"null",
		[
			["a plain name", '"Ruby"'],
			["Japanese", '"日本語"'],
			["an escaped symbol", '"C#"'],
			["a percent sign", '"100%"'],
			["an emoji", '"🦀"'],
			["40 astral characters", '40 times "𝒳"'],
			["40 decomposed letters", '40 times "e" U+0301'],
		],
	],
	[
		"A display name of the wrong length",
		'"length"',
		[
			["empty", '""'],
			["41 code points", '41 times "x"'],
			["41 astral characters", '41 times "𝒳"'],
			["41 decomposed letters", '41 times "e" U+0301'],
		],
	],
	[
		"A display name with a forbidden character",
		'"character"',
		[
			["a space", '"a b"'],
			["only a space", '" "'],
			["a no-break space", '"a" U+00A0 "b"'],
			["an ideographic space", '"a" U+3000 "b"'],
			["a line separator", '"a" U+2028 "b"'],
			["a tab", '"a" U+0009 "b"'],
			["a control character", '"a" U+0007 "b"'],
			["a zero width joiner", '"a" U+200D "b"'],
			["a private use character", '"a" U+E000 "b"'],
			["a lone surrogate", '"a" U+D800 "b"'],
			["an unassigned code point", '"a" U+0378 "b"'],
			["a colon", '"a:b"'],
			["a semicolon", '"a;b"'],
			["a slash", '"a/b"'],
			["a double quote", '"a" U+0022 "b"'],
			["a single quote", `"a'b"`],
			["a backquote", '"a`b"'],
			["a tilde", '"a~b"'],
			["a backslash", '"a\\b"'],
			["a vertical bar", '"a|b"'],
		],
	],
]) {
	for (const [caseName, name] of rows) {
		scenario(`${title} (${caseName})`, async ({ step }) => {
			let error;
			await step(`When tagNameError checks ${name}`, () => {
				error = N.tagNameError(text(name));
			});
			await step(`Then it returns ${result}`, () => {
				expect(error).toBe(JSON.parse(result));
			});
		});
	}
}

// ---- tagPart ----

for (const [caseName, name, part] of [
	["upper case", '"Ruby"', '"ruby"'],
	["a number sign", '"C#"', '"c~23"'],
	["a percent sign", '"100%"', '"100~25"'],
	[
		"every escaped symbol",
		'"!#$%&()*<>?[]^{}"',
		'"~21~23~24~25~26~28~29~2a~3c~3e~3f~5b~5d~5e~7b~7d"',
	],
	["other ASCII", '"a-b.c_d+e@f=g,h"', '"a-b.c_d+e@f=g,h"'],
	["a capital final sigma", '"ΟΔΟΣ"', '"οδοσ"'],
	["a written final sigma", '"οδος"', '"οδοσ"'],
	["a decomposed letter", '"Cafe" U+0301', '"caf" U+00E9'],
	["Japanese", '"日本語"', '"日本語"'],
	["a capital dotted I", '"İ"', '"i" U+0307'],
]) {
	scenario(
		`The file-name part of a display name (${caseName})`,
		async ({ step }) => {
			let result;
			await step(`When tagPart derives the part of ${name}`, () => {
				result = N.tagPart(text(name));
			});
			await step(`Then it is ${part}`, () => {
				expect(result).toBe(text(part));
			});
		},
	);
}

scenario("The part of a part is the same part", async ({ step }) => {
	let names;
	await step(
		'Given the display names "Ruby", "C#", "100%", "!#$%&()*<>?[]^{}", "ΟΔΟΣ", "Cafe" U+0301 and "İ"',
		() => {
			names = ["Ruby", "C#", "100%", "!#$%&()*<>?[]^{}", "ΟΔΟΣ", "Café", "İ"];
		},
	);
	let pairs;
	await step(
		"When tagPart derives the part of each and then the part of that part",
		() => {
			pairs = names.map((n) => {
				const part = N.tagPart(n);
				return [part, N.tagPart(part)];
			});
		},
	);
	await step("Then the second part is the first one each time", () => {
		for (const [first, second] of pairs) expect(second).toBe(first);
	});
});

// ---- tagFileName, tagNumber and tagRef ----

scenario(
	"A file name is the number in five digits and the part",
	async ({ step }) => {
		let made;
		await step(
			'When tagFileName makes the file names of 10 and "c~23" and of 99999 and "ruby"',
			() => {
				made = [N.tagFileName(10, "c~23"), N.tagFileName(99999, "ruby")];
			},
		);
		await step('Then they are "00010-c~23.html" and "99999-ruby.html"', () => {
			expect(made).toEqual(["00010-c~23.html", "99999-ruby.html"]);
		});
	},
);

scenario("The number and the reference of a file name", async ({ step }) => {
	let def;
	await step('Given the tag file "00120-c~23.html"', () => {
		def = tag("00120-c~23.html", "C#");
	});
	await step("Then tagNumber gives 120", () => {
		expect(N.tagNumber(def.file)).toBe(120);
	});
	await step('And tagRef gives "c~23"', () => {
		expect(N.tagRef(def)).toBe("c~23");
	});
});

scenario(
	"The reference of a decomposed file name is composed",
	async ({ step }) => {
		let def;
		await step(
			'Given the tag file "00010-cafe" U+0301 ".html", listed decomposed',
			() => {
				def = tag("00010-café.html", "Café");
			},
		);
		let ref;
		await step("When tagRef gives its reference", () => {
			ref = N.tagRef(def);
		});
		await step('Then it is "caf" U+00E9', () => {
			expect(ref).toBe("café");
		});
	},
);

// ---- tagDisplayName and sortTags ----

scenario("The display name of a reference", async ({ step }) => {
	let defs;
	await step(
		'Given the tag files "00010-c~23.html" named "C#" and "00020-ruby.html" named "Ruby"',
		() => {
			defs = [tag("00010-c~23.html", "C#"), tag("00020-ruby.html", "Ruby")];
		},
	);
	await step(
		'Then tagDisplayName gives "C#" for "c~23" and "Ruby" for "ruby"',
		() => {
			expect(N.tagDisplayName(defs, "c~23")).toBe("C#");
			expect(N.tagDisplayName(defs, "ruby")).toBe("Ruby");
		},
	);
	await step('And it gives "zig" for the undefined "zig"', () => {
		expect(N.tagDisplayName(defs, "zig")).toBe("zig");
	});
});

scenario(
	"References are sorted in the order of the tag files",
	async ({ step }) => {
		let defs;
		await step('Given the definitions "ruby", "go" and "rust"', () => {
			defs = defsOf("ruby", "go", "rust");
		});
		let sorted;
		await step(
			'When sortTags sorts "rust", "zig", "ruby", "ada" and "rust"',
			() => {
				sorted = N.sortTags(defs, ["rust", "zig", "ruby", "ada", "rust"]);
			},
		);
		await step('Then it returns "ruby", "rust", "zig" and "ada"', () => {
			expect(sorted).toEqual(["ruby", "rust", "zig", "ada"]);
		});
	},
);

scenario(
	"A decomposed file name sorts its composed reference",
	async ({ step }) => {
		let defs;
		await step(
			'Given the tag files "00010-cafe" U+0301 ".html" and "00020-ruby.html"',
			() => {
				defs = [tag("00010-café.html", "Café"), tag("00020-ruby.html", "ruby")];
			},
		);
		let sorted;
		await step('When sortTags sorts "ruby" and "caf" U+00E9', () => {
			sorted = N.sortTags(defs, ["ruby", "café"]);
		});
		await step('Then it returns "caf" U+00E9 and "ruby"', () => {
			expect(sorted).toEqual(["café", "ruby"]);
		});
	},
);

// ---- assignFileNames ----

scenario(
	"A tag keeps its number and takes the part of its name",
	async ({ step }) => {
		let tags;
		await step(
			'Given the tags "00010-ruby.html" named "Ruby" with a prompt, "00020-go.html" named "Golang" and a new tag "C#"',
			() => {
				tags = [
					tag("00010-ruby.html", "Ruby", {
						prompt: "Ruby prompt",
						memory: [{ text: "fact" }],
					}),
					tag("00020-go.html", "Golang"),
					tag(null, "C#"),
				];
			},
		);
		let assigned;
		await step("When assignFileNames gives them file names", () => {
			assigned = N.assignFileNames(tags);
		});
		await step(
			'Then the files are "00010-ruby.html", "00020-golang.html" and "00030-c~23.html"',
			() => {
				expect(files(assigned)).toEqual([
					"00010-ruby.html",
					"00020-golang.html",
					"00030-c~23.html",
				]);
			},
		);
		await step(
			"And the names, the prompt and the other fields are kept",
			() => {
				expect(assigned.map(({ file, ...rest }) => rest)).toEqual(
					tags.map(({ file, ...rest }) => rest),
				);
			},
		);
	},
);

scenario(
	"New tags are numbered after the largest number, in order",
	async ({ step }) => {
		let tags;
		await step(
			'Given a new tag "a", the tag "00050-b.html" named "b", a new tag "c" and the tag "00020-d.html" named "d"',
			() => {
				tags = [
					tag(null, "a"),
					tag("00050-b.html", "b"),
					tag(null, "c"),
					tag("00020-d.html", "d"),
				];
			},
		);
		let assigned;
		await step("When assignFileNames gives them file names", () => {
			assigned = N.assignFileNames(tags);
		});
		await step(
			'Then the files are "00060-a.html", "00050-b.html", "00070-c.html" and "00020-d.html"',
			() => {
				expect(files(assigned)).toEqual([
					"00060-a.html",
					"00050-b.html",
					"00070-c.html",
					"00020-d.html",
				]);
			},
		);
	},
);

scenario("The first new tags are numbered from 00010", async ({ step }) => {
	let tags;
	await step('Given the new tags "a" and "b"', () => {
		tags = [tag(null, "a"), tag(null, "b")];
	});
	let assigned;
	await step("When assignFileNames gives them file names", () => {
		assigned = N.assignFileNames(tags);
	});
	await step('Then the files are "00010-a.html" and "00020-b.html"', () => {
		expect(files(assigned)).toEqual(["00010-a.html", "00020-b.html"]);
	});
});

scenario("A new tag that would need six digits is full", async ({ step }) => {
	let tags;
	await step('Given the tag "99990-a.html" named "a" and a new tag "b"', () => {
		tags = [tag("99990-a.html", "a"), tag(null, "b")];
	});
	let error;
	await step("When assignFileNames gives them file names", () => {
		try {
			N.assignFileNames(tags);
		} catch (e) {
			error = e;
		}
	});
	await step('Then it throws "full"', () => {
		expect(error?.message).toBe("full");
	});
	await step(
		'And the tag "99999-a.html" named "a" alone keeps its file',
		() => {
			expect(files(N.assignFileNames([tag("99999-a.html", "a")]))).toEqual([
				"99999-a.html",
			]);
		},
	);
});

scenario("An invalid tag keeps its file name as it is", async ({ step }) => {
	let tags;
	await step(
		'Given the invalid tag "00020-Broken~2A.html" named "Broken~2A", the tag "00030-a.html" named "a" and a new tag "b"',
		() => {
			// A file put in t/ by hand: its part is not one tagPart would make (upper case, an escape in upper case)
			tags = [
				tag("00020-Broken~2A.html", "Broken~2A", { invalid: true }),
				tag("00030-a.html", "a"),
				tag(null, "b"),
			];
		},
	);
	let assigned;
	await step("When assignFileNames gives them file names", () => {
		assigned = N.assignFileNames(tags);
	});
	await step(
		'Then the files are "00020-Broken~2A.html", "00030-a.html" and "00040-b.html"',
		() => {
			expect(files(assigned)).toEqual([
				"00020-Broken~2A.html",
				"00030-a.html",
				"00040-b.html",
			]);
		},
	);
	await step("And the invalid tag is the same object", () => {
		expect(assigned[0]).toBe(tags[0]);
	});
});

// ---- renumber ----

scenario(
	"Renumbering numbers the tags in the given order and keeps their parts",
	async ({ step }) => {
		let tags;
		await step(
			'Given the tags "00050-go.html" named "Go", "00010-c~23.html" named "C#" and "00011-ruby.html" named "Ruby", in this order',
			() => {
				tags = [
					tag("00050-go.html", "Go"),
					tag("00010-c~23.html", "C#"),
					tag("00011-ruby.html", "Ruby"),
				];
			},
		);
		let renumbered;
		await step("When renumber renumbers them", () => {
			renumbered = N.renumber(tags);
		});
		await step(
			'Then the files are "00010-go.html", "00020-c~23.html" and "00030-ruby.html"',
			() => {
				expect(files(renumbered)).toEqual([
					"00010-go.html",
					"00020-c~23.html",
					"00030-ruby.html",
				]);
			},
		);
		await step("And the names are kept", () => {
			expect(renumbered.map((t) => t.name)).toEqual(["Go", "C#", "Ruby"]);
		});
	},
);

scenario("Renumbering composes a decomposed file name", async ({ step }) => {
	let tags;
	await step(
		'Given the tag "00070-cafe" U+0301 ".html" named "Café", listed decomposed',
		() => {
			tags = [tag("00070-café.html", "Café")];
		},
	);
	let renumbered;
	await step("When renumber renumbers it", () => {
		renumbered = N.renumber(tags);
	});
	await step('Then its file is "00010-caf" U+00E9 ".html"', () => {
		expect(files(renumbered)).toEqual(["00010-café.html"]);
	});
});

for (const [caseName, path, file] of [
	["an ASCII name", '"/t/00010-ruby.html"', '"00010-ruby.html"'],
	["an escape", '"/t/00020-c~23.html"', '"00020-c~23.html"'],
	[
		"percent-encoded",
		'"/t/00030-%E6%96%99%E7%90%86.html"',
		'"00030-料理.html"',
	],
	["decomposed", '"/t/00040-cafe%CC%81.html"', '"00040-caf" U+00E9 ".html"'],
	["below another directory", '"/site/t/00010-ruby.html"', '"00010-ruby.html"'],
	["a broken escape", '"/t/00010-%E6.html"', '"00010-%E6.html"'],
]) {
	scenario(
		`The file of a tag file's page is read from its path (${caseName})`,
		async ({ step }) => {
			let got;
			await step(`When tagFileOfPath reads the path ${path}`, () => {
				got = N.tagFileOfPath(text(path));
			});
			await step(`Then it returns ${file}`, () => {
				expect(got).toBe(text(file));
			});
		},
	);
}
