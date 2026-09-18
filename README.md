# discord-handle-watcher

![ci](https://github.com/quueli/discord-handle-watcher/actions/workflows/ci.yml/badge.svg)

watches a rate limited http api until a target string becomes available (a username in my case) and tells you. discord is the example provider, the limiter and the client dont care what api it is.

why it exists: the naive version got 429'd into a multi hour ban within minutes. so

- src/limiter.mjs: aimd. speed up slowly while responses are fine, cut the rate hard on a 429, remember the learned ceiling on disk so a restart doesnt start from zero, stretch the window when the bans get longer
- src/http.mjs: one undici pool, pre-warmed, requests serialized. saves 150-300ms per request compared to a fresh connection, which matters when the thing you want is gone in a second
- the choice of check endpoint matters. one is limited per account, the other per ip, and the second one is a trap. see src/providers/discord.mjs

    npm i
    cp .env.example .env
    node bin/cli.mjs watch

`npm test` runs the limiter tests with fake time. claiming is off by default, `--claim` turns it on, read the code before you do.
