#!/usr/bin/env bash

docker kill netamplify || true 
docker rm netamplify || true 
docker create --name netamplify -p 3000:3000 -p 4200:4200 localhost/netamplify
