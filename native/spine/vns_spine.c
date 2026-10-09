/* Small renderer-neutral ABI for the unmodified Spine 4.2 C runtime.
 * Spine runtime license/copyright: ../../vendor/spine-c/LICENSE. */
#include <spine/spine.h>
#include <spine/extension.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdio.h>
#include <math.h>

#ifdef _WIN32
#define VNS_API __declspec(dllexport)
#else
#define VNS_API __attribute__((visibility("default")))
#endif

typedef struct VnsBatch {
    int page, blend, vertex_count, index_count;
    float *positions, *attributes; /* xy; uv + light RGBA + dark RGB */
    uint32_t *indices;
    int vertex_capacity, index_capacity;
} VnsBatch;

typedef struct VnsSpine {
    spAtlas *atlas;
    spSkeletonData *data;
    spSkeleton *skeleton;
    spAnimationStateData *state_data;
    spAnimationState *state;
    spSkeletonClipping *clip;
    VnsBatch *batches;
    int batch_count, batch_capacity;
    float *world;
    int world_capacity;
} VnsSpine;

/* Texture files are loaded by the host. Retain the atlas' declared dimensions:
 * Unity may downsample the PNG, but UVs still refer to the original page size. */
void _spAtlasPage_createTexture(spAtlasPage *self, const char *path) { (void) self; (void) path; }
void _spAtlasPage_disposeTexture(spAtlasPage *self) { (void) self; }
char *_spUtil_readFile(const char *path, int *length) { (void) path; *length = 0; return NULL; }

VNS_API int vns_spine_abi(void) { return 1; }

VNS_API void vns_spine_dispose(VnsSpine *p) {
    if (!p) return;
    if (p->state) spAnimationState_dispose(p->state);
    if (p->state_data) spAnimationStateData_dispose(p->state_data);
    if (p->skeleton) spSkeleton_dispose(p->skeleton);
    if (p->data) spSkeletonData_dispose(p->data);
    if (p->atlas) spAtlas_dispose(p->atlas);
    if (p->clip) spSkeletonClipping_dispose(p->clip);
    for (int i = 0; i < p->batch_capacity; ++i) {
        free(p->batches[i].positions); free(p->batches[i].attributes); free(p->batches[i].indices);
    }
    free(p->batches); free(p->world); free(p);
}

VNS_API VnsSpine *vns_spine_create(const char *json, const char *atlas, char *error, int error_size) {
    VnsSpine *p = (VnsSpine *) calloc(1, sizeof(VnsSpine));
    if (!p) return NULL;
    p->atlas = spAtlas_create(atlas, (int) strlen(atlas), "", NULL);
    if (!p->atlas || !p->atlas->pages) {
        snprintf(error, error_size, "The atlas contains no texture pages.");
        vns_spine_dispose(p); return NULL;
    }
    int page_id = 0;
    for (spAtlasPage *page = p->atlas->pages; page; page = page->next) {
        page->rendererObject = (void *) (intptr_t) page_id++;
    }
    spSkeletonJson *reader = spSkeletonJson_create(p->atlas);
    p->data = spSkeletonJson_readSkeletonData(reader, json);
    if (!p->data) {
        snprintf(error, error_size, "%s", reader->error ? reader->error : "Invalid Spine JSON.");
        spSkeletonJson_dispose(reader); vns_spine_dispose(p); return NULL;
    }
    spSkeletonJson_dispose(reader);
    p->skeleton = spSkeleton_create(p->data);
    p->state_data = spAnimationStateData_create(p->data);
    p->state_data->defaultMix = 0.2f;
    p->state = spAnimationState_create(p->state_data);
    p->clip = spSkeletonClipping_create();
    p->batch_capacity = p->skeleton->slotsCount + 1;
    p->batches = (VnsBatch *) calloc(p->batch_capacity, sizeof(VnsBatch));
    spSkeleton_updateWorldTransform(p->skeleton, SP_PHYSICS_RESET);
    return p;
}

VNS_API int vns_spine_play(VnsSpine *p, const char *animation, const char *skin, int loop, float mix) {
    if (!p) return 0;
    spAnimation *a = animation && *animation ? spSkeletonData_findAnimation(p->data, animation) : NULL;
    if (animation && *animation && !a) return 0;
    spSkin *s = skin && *skin ? spSkeletonData_findSkin(p->data, skin) : p->data->defaultSkin;
    if (skin && *skin && !s) return 0;
    spSkeleton_setSkin(p->skeleton, s);
    spSkeleton_setSlotsToSetupPose(p->skeleton);
    if (a) {
        spTrackEntry *entry = spAnimationState_setAnimation(p->state, 0, a, loop);
        entry->mixDuration = mix;
    } else {
        spAnimationState_clearTracks(p->state);
        spSkeleton_setToSetupPose(p->skeleton);
    }
    spAnimationState_apply(p->state, p->skeleton);
    spSkeleton_updateWorldTransform(p->skeleton, SP_PHYSICS_RESET);
    return 1;
}

VNS_API void vns_spine_update(VnsSpine *p, float delta) {
    if (!p || !isfinite(delta) || delta < 0) return;
    /* Fixed small substeps keep physics stable after a temporarily slow frame. */
    do {
        float step = delta > (1.0f / 30) ? (1.0f / 30) : delta;
        spAnimationState_update(p->state, step);
        spAnimationState_apply(p->state, p->skeleton);
        spSkeleton_update(p->skeleton, step);
        spSkeleton_updateWorldTransform(p->skeleton, SP_PHYSICS_UPDATE);
        delta -= step;
    } while (delta > 0.000001f);
}

static int world_reserve(VnsSpine *p, int count) {
    if (count <= p->world_capacity) return 1;
    float *next = (float *) realloc(p->world, sizeof(float) * count);
    if (!next) return 0;
    p->world = next; p->world_capacity = count; return 1;
}

static int batch_reserve(VnsBatch *b, int vertices, int indices) {
    if (vertices > b->vertex_capacity) {
        int capacity = vertices * 2;
        float *pos = (float *) realloc(b->positions, sizeof(float) * capacity * 2);
        if (!pos) return 0;
        b->positions = pos;
        float *attrs = (float *) realloc(b->attributes, sizeof(float) * capacity * 9);
        if (!attrs) return 0;
        b->attributes = attrs; b->vertex_capacity = capacity;
    }
    if (indices > b->index_capacity) {
        int capacity = indices * 2;
        uint32_t *idx = (uint32_t *) realloc(b->indices, sizeof(uint32_t) * capacity);
        if (!idx) return 0;
        b->indices = idx; b->index_capacity = capacity;
    }
    return 1;
}

/* Returns triangle batches in draw order; storage is valid until the next call.
 * Coordinates use the host's top-left origin, without changing bone handedness. */
VNS_API int vns_spine_render(VnsSpine *p, float x, float y, float scale_x, float scale_y, float rotation) {
    if (!p) return -1;
    p->batch_count = 0;
    const float radians = rotation * 3.14159265358979323846f / 180;
    const float cosine = cosf(radians), sine = sinf(radians);
    unsigned short quad[] = {0, 1, 2, 2, 3, 0};
    spSkeletonClipping_clipEnd2(p->clip);
    for (int i = 0; i < p->skeleton->slotsCount; ++i) {
        spSlot *slot = p->skeleton->drawOrder[i];
        spAttachment *attachment = slot->attachment;
        if (!attachment || !slot->bone->active) { spSkeletonClipping_clipEnd(p->clip, slot); continue; }
        if (attachment->type == SP_ATTACHMENT_CLIPPING) {
            spSkeletonClipping_clipStart(p->clip, slot, (spClippingAttachment *) attachment); continue;
        }
        spColor *tint = NULL;
        spAtlasRegion *region = NULL;
        float *uvs = NULL;
        unsigned short *indices = NULL;
        int float_count = 0, index_count = 0;
        if (attachment->type == SP_ATTACHMENT_REGION) {
            spRegionAttachment *a = (spRegionAttachment *) attachment;
            float_count = 8;
            if (!world_reserve(p, float_count)) return -1;
            spRegionAttachment_computeWorldVertices(a, slot, p->world, 0, 2);
            region = (spAtlasRegion *) a->region; tint = &a->color;
            uvs = a->uvs; indices = quad; index_count = 6;
        } else if (attachment->type == SP_ATTACHMENT_MESH || attachment->type == SP_ATTACHMENT_LINKED_MESH) {
            spMeshAttachment *a = (spMeshAttachment *) attachment;
            if (a->sequence) spSequence_apply(a->sequence, slot, attachment);
            float_count = a->super.worldVerticesLength;
            if (!world_reserve(p, float_count)) return -1;
            spVertexAttachment_computeWorldVertices(&a->super, slot, 0, float_count, p->world, 0, 2);
            region = (spAtlasRegion *) a->region; tint = &a->color;
            uvs = a->uvs; indices = a->triangles; index_count = a->trianglesCount;
        }
        if (!region || !float_count || !index_count || !tint || slot->color.a <= 0 || tint->a <= 0) {
            spSkeletonClipping_clipEnd(p->clip, slot); continue;
        }
        float *positions = p->world;
        if (spSkeletonClipping_isClipping(p->clip)) {
            spSkeletonClipping_clipTriangles(p->clip, positions, float_count, indices, index_count, uvs, 2);
            positions = p->clip->clippedVertices->items; float_count = p->clip->clippedVertices->size;
            uvs = p->clip->clippedUVs->items; indices = p->clip->clippedTriangles->items; index_count = p->clip->clippedTriangles->size;
        }
        if (index_count) {
            int page = (int) (intptr_t) region->page->rendererObject;
            int blend = slot->data->blendMode;
            VnsBatch *b = p->batch_count ? &p->batches[p->batch_count - 1] : NULL;
            if (!b || b->page != page || b->blend != blend) {
                b = &p->batches[p->batch_count++];
                b->page = page; b->blend = blend; b->vertex_count = b->index_count = 0;
            }
            int count = float_count / 2, offset = b->vertex_count;
            if (!batch_reserve(b, offset + count, b->index_count + index_count)) return -1;
            float alpha = p->skeleton->color.a * slot->color.a * tint->a;
            float light[] = {p->skeleton->color.r * slot->color.r * tint->r * alpha,
                p->skeleton->color.g * slot->color.g * tint->g * alpha,
                p->skeleton->color.b * slot->color.b * tint->b * alpha, alpha};
            for (int v = 0; v < count; ++v) {
                float px = positions[v * 2] * scale_x, py = -positions[v * 2 + 1] * scale_y;
                b->positions[(offset + v) * 2] = x + px * cosine - py * sine;
                b->positions[(offset + v) * 2 + 1] = y + px * sine + py * cosine;
                float *a = &b->attributes[(offset + v) * 9];
                a[0] = uvs[v * 2]; a[1] = uvs[v * 2 + 1];
                for (int k = 0; k < 4; ++k) a[2 + k] = light[k];
                a[6] = slot->darkColor ? slot->darkColor->r * alpha : 0;
                a[7] = slot->darkColor ? slot->darkColor->g * alpha : 0;
                a[8] = slot->darkColor ? slot->darkColor->b * alpha : 0;
            }
            for (int j = 0; j < index_count; ++j) b->indices[b->index_count + j] = offset + indices[j];
            b->vertex_count += count; b->index_count += index_count;
        }
        spSkeletonClipping_clipEnd(p->clip, slot);
    }
    spSkeletonClipping_clipEnd2(p->clip);
    return p->batch_count;
}

VNS_API const VnsBatch *vns_spine_batch(VnsSpine *p, int index) {
    return p && index >= 0 && index < p->batch_count ? &p->batches[index] : NULL;
}
