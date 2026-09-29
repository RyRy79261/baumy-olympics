"use client";

import { useEffect, useRef } from "react";

// React 19 resets a <form> after its action runs (form.reset()). A reset puts
// every radio back to its page-load `checked`, but a controlled radio group
// keeps its chosen value in state, so the tiles still show the pick while
// the form would post the old one on the next submit. Dropped inside a
// radio group's fieldset, this puts the radios back on `value` right after
// the form resets (issue #106 review).

export function RadiosFollowReset({
  name,
  value,
}: {
  name: string;
  value: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(() => {
    const group = ref.current?.closest("fieldset");
    const form = group?.form ?? ref.current?.closest("form");
    if (!group || !form) return;
    const onReset = () => {
      // The reset event fires before the form resets its controls.
      queueMicrotask(() => {
        for (const radio of group.querySelectorAll<HTMLInputElement>(
          'input[type="radio"]',
        )) {
          if (radio.name === name)
            radio.checked = radio.value === latest.current;
        }
      });
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [name]);
  return <span ref={ref} hidden />;
}
