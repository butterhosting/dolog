#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMEOUT=30
# not 3000, so this can run while `bun dev` or the e2e stack is up; see the compose files
BASE_URL="http://localhost:3000"

passed=0
failed=0
active_project=""
active_compose=""

cleanup() {
    if [ -n "$active_project" ] && [ -n "$active_compose" ]; then
        docker compose -p "$active_project" -f "$active_compose" down -v --timeout 5 >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

teardown() {
    docker compose -p "$active_project" -f "$active_compose" down -v --timeout 5 >/dev/null 2>&1
    active_project=""
    active_compose=""
}

build_image() {
    label="$1"
    shift
    printf "\n  BUILD %s\n" "$label"
    build_log=$(mktemp)
    if ! ./dolog image create "$@" >"$build_log" 2>&1; then
        cat "$build_log"
        printf "  FAIL  %s (image build failed)\n" "$label"
        rm -f "$build_log"
        exit 1
    fi
    rm -f "$build_log"
}

assert_status() {
    expected="$1"
    path="$2"
    shift 2
    # bounded, because an endpoint waiting on an unreachable docker socket never answers at all
    status=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE_URL$path" "$@" || true)
    if [ "$status" != "$expected" ]; then
        printf "    FAIL  expected %s, got %s → %s %s\n" "$expected" "$status" "$path" "$*"
        return 1
    fi
    printf "    OK    %s → %s %s\n" "$expected" "$path" "$*"
    return 0
}

run_scenario() {
    name="$1"
    compose_file="$2"
    verify_fn="$3"
    project="dolog-test-${name}"
    active_project="$project"
    active_compose="$compose_file"

    printf "\n  TEST  %s\n" "$name"

    # Start the scenario
    docker compose -p "$project" -f "$compose_file" up -d --wait-timeout "$TIMEOUT" 2>/dev/null

    # Poll for startup message or failure
    elapsed=0
    while [ "$elapsed" -lt "$TIMEOUT" ]; do
        logs=$(docker compose -p "$project" -f "$compose_file" logs dolog 2>&1)

        if printf "%s" "$logs" | grep -q "Dolog started"; then
            printf "%s\n" "$logs"

            # Run HTTP verification
            if $verify_fn; then
                printf "  PASS  %s\n" "$name"
                passed=$((passed + 1))
            else
                printf "  FAIL  %s (verification failed)\n" "$name"
                failed=$((failed + 1))
            fi

            teardown
            return 0
        fi

        # Check if the container exited (nonzero exit = crash)
        if ! docker compose -p "$project" -f "$compose_file" ps --status running 2>/dev/null | grep -q dolog; then
            printf "%s\n" "$logs"
            printf "  FAIL  %s (container exited)\n" "$name"
            failed=$((failed + 1))
            teardown
            return 1
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    docker compose -p "$project" -f "$compose_file" logs dolog 2>&1
    printf "  FAIL  %s (timeout after %ds)\n" "$name" "$TIMEOUT"
    failed=$((failed + 1))
    teardown
    return 1
}

# ─── verification functions ───

# `/internal-api/host` is the one that proves the docker socket can be reached as the unprivileged user
verify_no_auth() {
    assert_status "200" /health \
    && assert_status "200" /internal-api/env \
    && assert_status "200" /internal-api/host \
    && assert_status "200" /internal-api/svcs \
    && assert_status "404" /internal-api/restricted/purge -X POST
}

# ─── scenarios ───

cd "$ROOT"

build_image "default"
run_scenario "fully-accessible" "$SCRIPT_DIR/compose.yaml" verify_no_auth

# ─── summary ───

printf "\n  %d passed, %d failed\n\n" "$passed" "$failed"
[ "$failed" -eq 0 ]
