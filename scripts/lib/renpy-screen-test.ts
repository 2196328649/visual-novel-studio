/** Non-interactive modal screens have no text focus for Ren'Py's string selector.
 * Inspect Text displayables present in the render tree, then capture screenshots
 * to verify their visual appearance. This helper is injected into QA copies only.
 */
export const renderedScreenTextHelper = `init python:
    def vns_test_rendered_texts(screen_name):
        screen = renpy.get_screen(screen_name)
        result = []
        if screen is None:
            return result
        def collect(displayable):
            if isinstance(displayable, renpy.text.text.Text):
                focus = renpy.test.testfocus.focus_from_displayable(displayable)
                if focus is not None and focus.w > 0 and focus.h > 0:
                    result.append(displayable.get_all_text())
        screen.visit_all(collect)
        return result
`;
