#!/bin/bash
# Records a Claude Code session running in tmux: saves the pane, with its
# colors, twice a second until <out dir>/STOP exists.
# Usage: ./record.sh <tmux session> <out dir>
session=${1:?tmux session name}
out=${2:?output folder}
mkdir -p "$out"
while [ ! -f "$out/STOP" ]; do
  tmux capture-pane -t "$session" -p -e > "$out/$(date +%s%3N).ans" 2>/dev/null || break
  sleep 0.5
done
