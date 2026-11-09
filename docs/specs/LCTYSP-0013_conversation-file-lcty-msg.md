<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

# LCTYSP-0013: Conversation file (`lcty-msg`)

- Status: Draft. It is to supersede [LCTYSP-0003](LCTYSP-0003_conversation-file.md), which describes the files of
  today, once the pages write this format; the RPC prototype writes it already, into `c-next/`.
- Related: [LCTYSP-0003](LCTYSP-0003_conversation-file.md) (the current format, and the rules this one keeps: the head,
  the title slot, characters XML cannot represent, the presentation allowlist),
  [LCTYSP-0012](LCTYSP-0012_rpc-protocol.md) (the protocol that writes it)
- Implementation: `lib/rpc/conv_store.rb` (prototype); tested by [LCTYSP-3020](LCTYSP-3020_rpc.feature)

## Principles

- **`lcty-msg` is the core of a conversation.** Joining the `data-content` of every `lcty-msg` in file order (the
  value of `data-content-base64` decoded, where that is written), separated by `"\n\n"`, always reads as the
  conversation. The same elements, and only they, are what the history sent to the model is built from and what a
  Markdown export contains: `lcty-msg` defines the boundary of all three.
- **Everything else is incidental.** `lcty-thinking`, `lcty-tool` and `lcty-cmd` record what happened around the
  messages (thoughts, tool calls, commands). They are never part of the joined text or of an export, and may depend on
  the model, the backend or the page that wrote them. The element name alone tells which kind a line is.
- **Fat client, thin server.** The client builds every element: its attributes, its text and its rendered
  presentation. The server checks what it receives and writes it, or rejects the whole request (nothing of it is
  written); it never completes or corrects an element. Two exceptions: the title, which the server fits into the slot
  (as today), and `data-content-integrity`, which the server computes when the client sends the placeholder.
- **Lines are independent.** Every element is one line, and a line is checked on its own. The order of the lines has
  a canonical form (below), but it is not validated when writing, since that would mean reading the file; a reader
  makes the best of a file whose lines are out of order.
- **A file changes only at its end, one line at a time.** The only operations on the elements are appending one
  element at the end and removing the last one ([Writing](#writing)); the title slot is still overwritten in place.
  Nothing in the middle of a file is ever rewritten.
- **The file does not hold the tags of a conversation.** Which tags a conversation has is kept only in the tag
  database ([LCTYSP-0009](LCTYSP-0009_tags-and-memory.md)); pages read them from the browser's copy of it. The
  `data-tag` of a `system` or `memory` only records where that snapshot came from.
- **No forks.** Copying a conversation creates a new one with every id assigned anew, so the same id never appears in
  two files and a copied message needs no mark.
- **One user.** The system is personal: there is only ever one user, possibly with several tabs. Where tabs disagree,
  the page asks the user.

## Example

```html
<!DOCTYPE html><html lang="ja" />
<head>…(line 2 as today)…</head>
<title id="__512">IndexedDBとlocalStorageの違い</title><!--…<!---->
<lcty-c id="c-20261105-100824-d3ad" data-created-at="2026-11-05T10:08:24+09:00" />
<lcty-msg data-role="system" id="sys-…" data-template="thinking" data-content-integrity="sha384-…" data-content="たくさん考えて"><article><p>たくさん考えて</p></article></lcty-msg>
<lcty-msg data-role="system" id="sys-…" data-tag="Ruby" data-content-integrity="sha384-…" data-content="あなたは Ruby に詳しいプログラマーです。"><article><p>あなたは Ruby に詳しいプログラマーです。</p></article></lcty-msg>
<lcty-msg data-role="memory" id="mem-…" data-tag="Ruby" data-content-integrity="sha384-…" data-content="ユーザーは macOS 付属の Ruby 2.6 を使っている"><article><p>ユーザーは macOS 付属の Ruby 2.6 を使っている</p></article></lcty-msg>
<lcty-msg data-role="system" id="sys-…" data-content-integrity="sha384-…" data-content="今回はフィボナッチ数列"><article><p>今回はフィボナッチ数列</p></article></lcty-msg>
<lcty-msg data-role="user" id="msg-u-…" data-at="2026-11-05T10:09:51+09:00" data-content-integrity="sha384-…" data-content="ブラウザの IndexedDB と localStorage の違いは？"><article>ブラウザの IndexedDB と localStorage の違いは？</article></lcty-msg>
<lcty-thinking id="think-…" data-at="2026-11-05T10:09:51+09:00" data-content-integrity="sha384-…" data-content="思考です"><article><p>思考です</p></article></lcty-thinking>
<lcty-msg data-role="model" id="msg-m-…" data-at="2026-11-05T10:10:37+09:00" data-content-integrity="sha384-…" data-content="ブラウザのクライアントサイド…"><article><p>ブラウザのクライアントサイド…</p></article></lcty-msg>
```

Lines 1 to 4 keep the layout of the head of [LCTYSP-0003](LCTYSP-0003_conversation-file.md), and the page creating the
conversation chooses what they hold: the language (`lang` of line 1, and the language file line 2 loads,
`lcty.<version>.lang-<lang>.js`; none for `en`, whose texts are built into `lcty.<version>.js`), the version of the
`lcty.*` files line 2 loads (`v1` today), and the size of the title slot on line 3 (its id, `__<size>`). Line 4 is
`<lcty-c id="c-<id>" data-created-at="…" />`. Every line from line 5 on is one of the elements below.

## `lcty-msg`

- **`data-role`** is one of `system`, `memory`, `user` and `model`.
  - `system`: an instruction to the model. `data-template` names the template it came from; `data-tag` names the tag it
    came from; one without either is the instruction of this conversation.
  - `memory`: a memory of a tag (`data-tag`).
  - `user`: a message of the user.
  - `model`: a reply of the model.
- **`system` and `memory` are a snapshot taken when the conversation is created.** They are written before the first
  `user` and are not added later: changing the tags of a conversation affects the next conversation, not this one.
  `data-created-at` of `lcty-c` is their time. Their `data-tag` is where they came from, not the tags of the
  conversation (which the tag database holds); the tags at creation can be read back from them by reading the file.
- **`id`** is a prefix from the role followed by a UUIDv7: `sys-` (system), `mem-` (memory), `msg-u-` (user) and
  `msg-m-` (model). The server rejects an id whose prefix does not match `data-role`.
- **`data-at`** is when a `user` or `model` message was written.
- **`data-content`** is the text, kept byte for byte. A text holding characters XML cannot represent is written as
  `data-content-base64` instead (the rule of [Characters XML cannot
  represent](LCTYSP-0003_conversation-file.md#characters-xml-cannot-represent)); exactly one of the two is written, and
  the client chooses it by that rule.
- **`data-content-integrity`** is `sha384-` followed by the base64 (with padding) of the SHA-384 of the UTF-8 bytes of
  the text, as in Subresource Integrity. It is there to find format errors (an attribute written or read wrongly, a
  file edited by hand); it is not checked when writing. Checking it is left to whoever needs it: a check at startup, a
  script, the tests. A mismatch is reported as a format error and does not stop the file from being read. The client
  may send the placeholder `sha384-` (no digest), and the server then computes the value and writes it.
- **Attributes come in one order:** `data-role`, `id`, `data-at`, `data-template`, `data-tag`,
  `data-content-integrity`, then `data-content` or `data-content-base64`. An attribute that does not apply is left out.
  The server rejects attributes in any other order and never reorders them.
- **The child is one `<article>`,** the presentation, rendered by the client: the text as it is for `user` (shown with
  its newlines kept), and the HTML rendered from Markdown for the other roles. The server rejects an `<article>` that
  holds anything outside the [presentation allowlist](LCTYSP-0003_conversation-file.md#presentation-allowlist), and for
  `user` one that holds anything but the text. The attribute is the source of truth; the presentation is for reading the
  file without scripts.

## The history sent to the model

Built from the file in order, element by element, by the element's name (Responses API,
[LCTYSP-0002](LCTYSP-0002_llm-backend.md)):

- `system` and `memory`: their texts joined by `"\n\n"`, in file order, are `instructions`. Nothing else is added.
- `user`: `{role: "user", content}`.
- `model`: `{type: "message", role: "assistant", content}`; a reply with an empty text is not sent.
- `lcty-thinking`, `lcty-cmd` (and its children): not sent.
- `lcty-tool`: sent only within the current turn (after the last `user`), so that the model can use the results of its
  calls; never for earlier turns. Past turns are therefore exactly the `lcty-msg` elements.

## `lcty-thinking`

The model's thinking for a reply, written before the `model` it belongs to. It has `id` (`think-` and a UUIDv7),
`data-at`, `data-content-integrity` and `data-content` (or `data-content-base64`), in that order, and an `<article>`
rendered like a reply. It is never sent back to the model.

## `lcty-cmd`

`lcty-cmd` marks that something is being built in the conversation: a reply being generated, a tool being called. It
works as a lock held by the file.

- **It is only ever the last element, and there is at most one.** While the last element is an `lcty-cmd`, nothing
  can be appended; the only operation allowed is removing that `lcty-cmd`. An `lcty-cmd` can be appended only when the
  last element is not one. Both rules are checked on the last line alone.
- **It holds what is being built as its children, and its children are never written to the file.** A message being
  generated (an `lcty-msg` among them) is shown inside it. When the work is done, the page removes the `lcty-cmd` and
  appends the finished elements one by one.
- **Attributes:** `id` (`cmd-` and a UUIDv7), `data-op` (the operation), `data-at`, and `data-error` when the work
  failed. A failed `lcty-cmd` stays as the last element with `data-error` until it is removed; the rest of how a failure
  is recorded is left to the page.
- **A lock nobody holds** (its page was closed or crashed) is found when a page sees an `lcty-cmd` it did not start
  as the last element. The page asks the user whether to run it again or remove it.
- Its other contents are designed later.

## `lcty-tool`

`lcty-tool` records a tool call and its result; it is designed later, and only its name is fixed now. Its form depends
on the API and the model (how a call is shaped, who assigns its id, how parallel calls are ordered), so it is a record
for the environment that produced it rather than a portable form. It is sent only as described above.

## Writing

The client sends an element as JSON, `{attrs, innerHTML}`, where `attrs` holds the attributes in the order above and
`innerHTML` the presentation (empty for `lcty-cmd`). Apart from creating a file and overwriting the title slot, there
are only two operations:

- **Appending one element.** The request names `after`, the id of the last element as the page knows it. The server
  appends only when the last element of the file has that id, and otherwise rejects the request with the id it found.
- **Removing the last element.** The request names the id of the element to remove. The server removes it only when
  it is the last element of the file, by truncating the file at the start of its line, and otherwise rejects the
  request with the id it found.

Everything else is a sequence of these. Creating a conversation writes lines 1 to 4 (and fails when the file exists),
then appends the first elements one by one; finishing a reply removes the `lcty-cmd` and appends the results; undoing
removes elements from the end one by one. Two tabs acting at once cannot both succeed, and a request sent again after
it succeeded is recognised (the last id is then the page's own). A sequence interrupted halfway leaves a file that is
still read as well as it can be.

- **Not in the file:** the timings, the token usage and which client and model produced a reply are kept in a database
  keyed by the message id, not in the file.

## Moving existing files

Existing files are converted once to this format. `lcty-setup` becomes a `system` `lcty-msg` without `data-tag`;
messages with `data-role` `user` and `assistant` become `user` and `model`; `data-thinking` becomes an `lcty-thinking`
before its reply; `data-timings`, `data-usage` and `data-client` move to the database; `data-inherited` and
the tags on line 4 are dropped; `div.user-text` becomes `<article>`; `data-content-integrity` is computed. The ids get
the new prefixes, and links to the old ids (`#c-msg-…`) are not kept.

## Open points

- The forms of `lcty-tool`, and the contents of `lcty-cmd` beyond the attributes above.
- How a stopped reply is recorded beyond `data-error`, and how an `incomplete` reply of today is converted.
- The hash that identifies the state of a conversation (for checking a page against the server), decided once this
  format is stable.
- How an export looks (headings for the roles, how the text of `user` is quoted, separators).
- How `system` and `memory` are shown on the page ([LCTYSP-0005](LCTYSP-0005_page-and-elements.md)).
