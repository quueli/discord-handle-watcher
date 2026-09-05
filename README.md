# discord-handle-watcher

watches a rate limited http api until a target string becomes available (a username in my case) and tells you. discord is the example provider, the limiter and the client dont care what api it is.

    npm i
    cp .env.example .env
    node bin/cli.mjs watch
