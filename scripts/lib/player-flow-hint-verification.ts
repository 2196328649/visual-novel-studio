/** Native pixel evidence for the actual hint widgets shown by a flowchart.
 * Kept separate from product geometry so an empty render, text fallback or
 * closed square cannot pass merely by carrying the expected metadata. */
export function playerFlowHintVerificationSource() {
  return `
init python:
    def qa_flow_hint_sample(screen_name, identity):
        widget = renpy.get_widget(screen_name, identity)
        sample = dict(identity=identity, className=type(widget).__name__, expectedSize=[22, 22])
        checks = dict(exists=widget is not None, vectorType=isinstance(widget, VnBrowseHint), noText=not isinstance(widget, renpy.text.text.Text))
        if not checks['vectorType']:
            return dict(sample, checks=checks, passed=False)
        size, stroke = widget.size, widget.line_width
        points = [list(point) for point in widget.points]
        sample.update(size=size, strokeWidth=stroke, points=points)
        checks['compactSize'] = size == 22 and 1 <= stroke <= 3
        checks['rightChevron'] = (len(points) == 3 and points[0][0] == points[2][0]
            and points[1][0] - points[0][0] >= size * .2
            and points[0][1] < points[1][1] < points[2][1]
            and points[2][1] - points[0][1] >= size * .45
            and abs(points[0][1] + points[2][1] - 2 * points[1][1]) <= 1
            and all(0 < x < size - 1 and 0 < y < size - 1 for x, y in points))
        rendered = renpy.render(widget, 64, 64, 0, 0)
        surface = renpy.render_to_surface(rendered, resize=True)
        width, height = surface.get_size()
        sample.update(renderSize=list(rendered.get_size()), surfaceSize=[width, height])
        checks['renderSize'] = list(rendered.get_size()) == [22, 22] and [width, height] == [22, 22]
        if not checks['renderSize'] or not checks['rightChevron']:
            return dict(sample, checks=checks, passed=False)
        pixels = [[list(surface.get_at((x, y))) for x in range(width)] for y in range(height)]
        ink = [(x, y) for y in range(height) for x in range(width) if pixels[y][x][3] >= 32]
        def distance(point, start, end):
            dx, dy = end[0] - start[0], end[1] - start[1]
            fraction = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / float(dx * dx + dy * dy)))
            return ((point[0] - start[0] - fraction * dx) ** 2 + (point[1] - start[1] - fraction * dy) ** 2) ** .5
        segments = list(zip(points, points[1:]))
        maximum_distance = max((min(distance(point, start, end) for start, end in segments) for point in ink), default=0.0)
        probes = []
        for index, (start, end) in enumerate(segments):
            for fraction in (0.0, .25, .5, .75, 1.0):
                x = int(start[0] + (end[0] - start[0]) * fraction + .5)
                y = int(start[1] + (end[1] - start[1]) * fraction + .5)
                neighbors = [(px, py) for py in range(max(0, y - 1), min(height, y + 2)) for px in range(max(0, x - 1), min(width, x + 2))]
                peak = max(neighbors, key=lambda point: pixels[point[1]][point[0]][3])
                probes.append(dict(segment=index, fraction=fraction, point=[x, y], peakPoint=list(peak), rgba=pixels[peak[1]][peak[0]]))
        guards = [[points[0][0], points[1][1]], [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width // 2, 0], [width // 2, height - 1]]
        background = [dict(point=point, rgba=pixels[point[1]][point[0]]) for point in guards]
        color = [int(round(channel * 255)) for channel in Color(widget.style.color).rgb]
        checks['visibleStroke'] = len(ink) >= size and all(probe['rgba'][3] >= 96 for probe in probes)
        checks['onlyTwoSlants'] = maximum_distance <= stroke + 1.5 and len(ink) < width * height / 3
        checks['openLeftAndClearMargin'] = all(probe['rgba'][3] <= 16 for probe in background)
        checks['strokeColor'] = all(all(abs(probe['rgba'][channel] - color[channel]) <= 16 for channel in range(3)) for probe in probes)
        sample.update(inkPixels=len(ink), maximumDistanceFromSlants=maximum_distance, expectedRgb=color, probes=probes, background=background,
            alphaRows=[''.join('0123456789abcdef'[min(15, pixel[3] // 16)] for pixel in row) for row in pixels], checks=checks, passed=all(checks.values()))
        return sample

    def qa_flow_hint_check(screen_name, identities, trace_name):
        samples = [qa_flow_hint_sample(screen_name, identity) for identity in identities]
        qa_trace(trace_name, samples=samples)
        return bool(samples) and all(sample['passed'] for sample in samples)
`;
}
