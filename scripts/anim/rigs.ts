/**
 * Source skeletons the clip pipeline understands: which source joint drives
 * each of Nora's 19 joints, and which joint marks the far end of each limb.
 * Add a profile here to retarget from another skeleton.
 */
import type { RetargetJoint } from '../../src/render/nora';

export interface SourceRig {
  /** Source joint (or two joints to average) driving each of Nora's joints. */
  joints: Record<RetargetJoint, string | [string, string]>;
  /** Far end of each limb (and of the hands), for its direction. */
  ends: Partial<Record<RetargetJoint, string>>;
  /** Normalises a node name from the file (e.g. strips a namespace prefix). */
  name(node: string): string;
}

/** Quaternius Universal Animation Library (Unreal mannequin names). */
const UAL: SourceRig = {
  joints: {
    hips: 'pelvis',
    spine: ['spine_01', 'spine_02'],
    chest: 'spine_03',
    neck: 'neck_01',
    head: 'Head',
    shoulder_L: 'clavicle_l',
    upperArm_L: 'upperarm_l',
    lowerArm_L: 'lowerarm_l',
    hand_L: 'hand_l',
    shoulder_R: 'clavicle_r',
    upperArm_R: 'upperarm_r',
    lowerArm_R: 'lowerarm_r',
    hand_R: 'hand_r',
    thigh_L: 'thigh_l',
    shin_L: 'calf_l',
    foot_L: 'foot_l',
    thigh_R: 'thigh_r',
    shin_R: 'calf_r',
    foot_R: 'foot_r',
  },
  ends: {
    upperArm_L: 'lowerarm_l',
    lowerArm_L: 'hand_l',
    hand_L: 'middle_01_l',
    upperArm_R: 'lowerarm_r',
    lowerArm_R: 'hand_r',
    hand_R: 'middle_01_r',
    thigh_L: 'calf_l',
    shin_L: 'foot_l',
    thigh_R: 'calf_r',
    shin_R: 'foot_r',
  },
  name: (n) => n,
};

/** Mixamo (mixamorig bone names, with or without a ":" or "_" after the prefix). */
const MIXAMO: SourceRig = {
  joints: {
    hips: 'Hips',
    spine: ['Spine', 'Spine1'],
    chest: 'Spine2',
    neck: 'Neck',
    head: 'Head',
    shoulder_L: 'LeftShoulder',
    upperArm_L: 'LeftArm',
    lowerArm_L: 'LeftForeArm',
    hand_L: 'LeftHand',
    shoulder_R: 'RightShoulder',
    upperArm_R: 'RightArm',
    lowerArm_R: 'RightForeArm',
    hand_R: 'RightHand',
    thigh_L: 'LeftUpLeg',
    shin_L: 'LeftLeg',
    foot_L: 'LeftFoot',
    thigh_R: 'RightUpLeg',
    shin_R: 'RightLeg',
    foot_R: 'RightFoot',
  },
  ends: {
    upperArm_L: 'LeftForeArm',
    lowerArm_L: 'LeftHand',
    hand_L: 'LeftHandIndex1',
    upperArm_R: 'RightForeArm',
    lowerArm_R: 'RightHand',
    hand_R: 'RightHandIndex1',
    thigh_L: 'LeftLeg',
    shin_L: 'LeftFoot',
    thigh_R: 'RightLeg',
    shin_R: 'RightFoot',
  },
  name: (n) => n.replace(/^mixamorig\d*[:_]?/, ''),
};

export const RIGS: Record<string, SourceRig> = { ual: UAL, mixamo: MIXAMO };
