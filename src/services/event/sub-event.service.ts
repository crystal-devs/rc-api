// services/event/sub-event.service.ts
//
// Manage the embedded event.sub_events[] (the India-native multi-function
// structure — haldi / sangeet / wedding / reception). Functions are bounded and
// live on the event doc; media links to one via media.sub_event_id (null = the
// whole-event / main gallery). See docs/ROADMAP.md Phase 1.

import mongoose from "mongoose";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import { ServiceResponse } from "@services/media";
import { logger } from "@utils/logger";

export interface SubEventInput {
    name?: string;
    date?: string | Date | null;
    order?: number;
}

const MAX_NAME = 80;

const ok = <T>(data: T, message: string): ServiceResponse<T> =>
    ({ status: true, code: 200, message, data, error: null, other: null });
const fail = (code: number, message: string): ServiceResponse<any> =>
    ({ status: false, code, message, data: null, error: null, other: null });

/** Sort helper: by explicit order, then date, then name — matches the timeline. */
const byTimeline = (a: any, b: any) =>
    (a.order ?? 0) - (b.order ?? 0) ||
    (a.date ? +new Date(a.date) : 0) - (b.date ? +new Date(b.date) : 0) ||
    String(a.name).localeCompare(String(b.name));

/**
 * Functions in timeline order. Every surface that renders sub-events (host
 * chips, guest section dividers) must use this so the order agrees everywhere.
 */
export const sortSubEvents = <T>(subs: T[] | null | undefined): T[] =>
    (subs ?? []).slice().sort(byTimeline);

function parseName(value: unknown): { name?: string; error?: string } {
    if (typeof value !== 'string' || !value.trim()) return { error: 'Sub-event name is required' };
    const name = value.trim();
    if (name.length > MAX_NAME) return { error: `Sub-event name must be ${MAX_NAME} characters or fewer` };
    return { name };
}

function parseDate(value: unknown): { date?: Date | null; error?: string } {
    if (value === null || value === undefined || value === '') return { date: null };
    const d = new Date(value as any);
    if (isNaN(d.getTime())) return { error: 'Invalid sub-event date' };
    return { date: d };
}

export const listSubEvents = async (eventId: string): Promise<ServiceResponse<any>> => {
    try {
        const event = await Event.findById(eventId).select('sub_events').lean();
        if (!event) return fail(404, 'Event not found');
        return ok(sortSubEvents(event.sub_events), 'Sub-events retrieved');
    } catch (error: any) {
        logger.error(`[listSubEvents] ${error.message}`);
        return fail(500, error.message || 'Failed to list sub-events');
    }
};

export const addSubEvent = async (eventId: string, input: SubEventInput): Promise<ServiceResponse<any>> => {
    try {
        const { name, error: nameErr } = parseName(input.name);
        if (nameErr) return fail(400, nameErr);
        const { date, error: dateErr } = parseDate(input.date);
        if (dateErr) return fail(400, dateErr);

        const event = await Event.findById(eventId).select('sub_events');
        if (!event) return fail(404, 'Event not found');

        const subs = event.sub_events as any; // mongoose DocumentArray
        const order = typeof input.order === 'number' ? input.order : subs.length;
        const subEvent = { _id: new mongoose.Types.ObjectId(), name, date: date ?? null, order };
        subs.push(subEvent);
        await event.save();

        return ok(subEvent, 'Sub-event created');
    } catch (error: any) {
        logger.error(`[addSubEvent] ${error.message}`);
        return fail(500, error.message || 'Failed to create sub-event');
    }
};

export const updateSubEvent = async (
    eventId: string,
    subEventId: string,
    input: SubEventInput
): Promise<ServiceResponse<any>> => {
    try {
        if (!mongoose.Types.ObjectId.isValid(subEventId)) return fail(400, 'Invalid sub-event id');

        const event = await Event.findById(eventId).select('sub_events');
        if (!event) return fail(404, 'Event not found');

        const sub = (event.sub_events as any).id(subEventId);
        if (!sub) return fail(404, 'Sub-event not found');

        if (input.name !== undefined) {
            const { name, error } = parseName(input.name);
            if (error) return fail(400, error);
            sub.name = name;
        }
        if (input.date !== undefined) {
            const { date, error } = parseDate(input.date);
            if (error) return fail(400, error);
            sub.date = date;
        }
        if (typeof input.order === 'number') sub.order = input.order;

        await event.save();
        return ok(sub, 'Sub-event updated');
    } catch (error: any) {
        logger.error(`[updateSubEvent] ${error.message}`);
        return fail(500, error.message || 'Failed to update sub-event');
    }
};

export const deleteSubEvent = async (eventId: string, subEventId: string): Promise<ServiceResponse<any>> => {
    try {
        if (!mongoose.Types.ObjectId.isValid(subEventId)) return fail(400, 'Invalid sub-event id');

        const event = await Event.findById(eventId).select('sub_events');
        if (!event) return fail(404, 'Event not found');

        const sub = (event.sub_events as any).id(subEventId);
        if (!sub) return fail(404, 'Sub-event not found');

        sub.deleteOne();
        await event.save();

        // Media tagged to the removed function falls back to the whole-event
        // gallery rather than being orphaned or hidden.
        await Media.updateMany(
            { event_id: new mongoose.Types.ObjectId(eventId), sub_event_id: new mongoose.Types.ObjectId(subEventId) },
            { $set: { sub_event_id: null } }
        );

        return ok({ _id: subEventId }, 'Sub-event deleted');
    } catch (error: any) {
        logger.error(`[deleteSubEvent] ${error.message}`);
        return fail(500, error.message || 'Failed to delete sub-event');
    }
};

/**
 * True when subEventId is a function of this event. Used by upload flows that
 * don't already have the event in hand to validate a client-supplied
 * sub_event_id before tagging media with it.
 */
export const isValidSubEventForEvent = async (
    eventId: string | mongoose.Types.ObjectId,
    subEventId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
    if (!subEventId || !mongoose.Types.ObjectId.isValid(subEventId)) return false;
    const event = await Event.findOne({ _id: eventId, 'sub_events._id': subEventId }).select('_id').lean();
    return !!event;
};

/**
 * Resolve a client-supplied function tag against an already-fetched event's
 * functions (no extra query). Returns the id only when it really is a function
 * of THIS event — which stops media being tagged with another event's function.
 *
 * An absent/unknown id resolves to null (the whole-event gallery) rather than
 * failing: the guest picker defaults to "the whole event", and a host may delete
 * a function while a guest still has it selected. An upload must never be lost
 * over a stale tag.
 */
export const resolveSubEventTag = (
    subEvents: any[] | null | undefined,
    candidate: unknown
): mongoose.Types.ObjectId | null => {
    if (typeof candidate !== 'string' || !mongoose.Types.ObjectId.isValid(candidate)) return null;
    const belongs = (subEvents ?? []).some((s: any) => s?._id?.toString() === candidate);
    if (!belongs) {
        logger.warn(`Ignoring unknown sub_event_id '${candidate}' — tagging media to the whole event`);
        return null;
    }
    return new mongoose.Types.ObjectId(candidate);
};
