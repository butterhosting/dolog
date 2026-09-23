#!/bin/sh
set -eu

IMAGE="butterhosting/dolog"
PLATFORMS="linux/amd64,linux/arm64"

usage() {
    printf "Usage: %s <command> [arguments]\n" "$(basename "$0")"
    printf "\nCommands:\n"
    printf "  create [options]     Build a production Docker image for this machine\n"
    printf "  publish [options]    Build the image for all platforms and push it to Docker Hub\n"
    printf "\nOptions:\n"
    printf "  --stage <stage>      The .env.<stage> to bake in (default: prod)\n"
    exit 1
}

require_commands() {
    for cmd in "$@"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            printf "Error: required command not found: %s\n" "$cmd"
            exit 1
        fi
    done
}

prepare_image() {
    stage="prod"

    while [ $# -gt 0 ]; do
        case "$1" in
            --stage)
                if [ $# -lt 2 ] || [ -z "$2" ] || case "$2" in -*) true;; *) false;; esac; then
                    printf "Error: --stage requires a value\n"
                    exit 1
                fi
                stage="$2"
                shift 2
                ;;
            *)
                printf "Error: unknown option '%s'\n\n" "$1"
                usage
                ;;
        esac
    done

    if [ ! -f ".env.${stage}" ]; then
        printf "Error: no .env.%s file found (available:" "$stage"
        for f in .env.*; do
            printf " %s" "${f#.env.}"
        done
        printf ")\n"
        exit 1
    fi

    commit=$(git rev-parse HEAD)

    exact_tag=$(git tag --points-at HEAD | head -n 1)
    if [ -n "$exact_tag" ]; then
        version="$exact_tag"
    else
        closest_tag=$(git describe --tags --abbrev=0 2>/dev/null || true)
        if [ -n "$closest_tag" ]; then
            version="${closest_tag}-snapshot"
        else
            version="0.0.0"
        fi
    fi

    tag="${IMAGE}:${version}"
    latest="${IMAGE}:latest"
    build_args="--build-arg STAGE=$stage --build-arg VERSION=$version --build-arg COMMIT=$commit"

    # a prerelease (1.0.0-alpha.1) does not become `latest`; a snapshot is never pushed, so it always does
    case "$exact_tag" in
        *-*) tags="-t $tag" ;;
        *) tags="-t $tag -t $latest" ;;
    esac

    printf "Stage %s, version %s, commit %s\n" "$stage" "$version" "$commit"
}

# --- routing ---

require_commands git docker

if [ $# -lt 1 ]; then
    usage
fi

command="$1"
shift

case "$command" in
    create)
        prepare_image "$@"
        printf "Building image > %s\n" "$tag"
        docker build $build_args $tags .
        printf "Created image > %s\n" "$tag"
        ;;
    # a multi-platform image cannot land in the local image store, so it is pushed as it is built
    publish)
        prepare_image "$@"
        printf "Publishing image > %s\n" "$tag"
        docker buildx build $build_args $tags --platform "$PLATFORMS" --push .
        printf "Published image > %s\n" "$tag"
        ;;
    *)
        printf "Error: unknown command '%s'\n\n" "$command"
        usage
        ;;
esac
