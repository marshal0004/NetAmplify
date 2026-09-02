#!/bin/bash

set -o xtrace

docker rmi localhost/netamplify || true
docker build --target dist -t localhost/netamplify -f Dockerfile.dev .
docker build --target devcontainer -t localhost/netamplify-devcontainer -f Dockerfile.dev .
