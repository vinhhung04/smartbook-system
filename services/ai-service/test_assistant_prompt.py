import unittest

from main import ASSISTANT_SYSTEM_PROMPT, _assistant_prompt_messages


class AssistantPromptMessagesTests(unittest.TestCase):
    def test_empty_history_yields_exactly_one_user_message(self):
        messages = _assistant_prompt_messages([], "X")
        user_messages = [m for m in messages if m["role"] == "user"]
        self.assertEqual(len(user_messages), 1)
        self.assertEqual(user_messages[0]["content"], "X")

    def test_the_current_question_is_never_duplicated_even_if_it_reappears_in_history(self):
        # Regression test for the real bug: the current message was written to
        # ai_messages BEFORE history was loaded, so it came back as the last
        # history row and was then appended again as the final user turn.
        history = [{"role": "assistant", "content": "trước đó"}, {"role": "user", "content": "X"}]
        messages = _assistant_prompt_messages(history, "X")
        occurrences = sum(1 for m in messages if m["role"] == "user" and m["content"] == "X")
        self.assertEqual(occurrences, 1)

    def test_system_prompt_is_first_and_appears_exactly_once(self):
        history = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
        messages = _assistant_prompt_messages(history, "c")
        self.assertEqual(messages[0], {"role": "system", "content": ASSISTANT_SYSTEM_PROMPT})
        self.assertEqual(sum(1 for m in messages if m["role"] == "system"), 1)

    def test_history_order_is_preserved_before_the_current_question(self):
        history = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
        messages = _assistant_prompt_messages(history, "c")
        self.assertEqual(
            [(m["role"], m["content"]) for m in messages],
            [("system", ASSISTANT_SYSTEM_PROMPT), ("user", "a"), ("assistant", "b"), ("user", "c")],
        )


if __name__ == "__main__":
    unittest.main()
