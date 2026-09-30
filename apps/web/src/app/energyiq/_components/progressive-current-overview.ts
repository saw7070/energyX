import type {
  EnergyProjectAnalysisResolutionDto,
  EnergyProjectOverviewMinimumDto,
} from "../../../lib/config-api";

type ProgressiveCurrentOverviewInput = {
  loadMinimum: () => Promise<EnergyProjectOverviewMinimumDto>;
  loadInitial: () => Promise<EnergyProjectAnalysisResolutionDto>;
  loadExact: (
    minimum: EnergyProjectOverviewMinimumDto,
  ) => Promise<EnergyProjectAnalysisResolutionDto>;
  validateMinimum: (minimum: EnergyProjectOverviewMinimumDto) => void;
  minimumMatchesResolution: (
    minimum: EnergyProjectOverviewMinimumDto,
    resolution: Extract<EnergyProjectAnalysisResolutionDto, { status: "ready" }>,
  ) => boolean;
  onMinimum: (minimum: EnergyProjectOverviewMinimumDto) => void;
  onLateIdentityMismatch?: (minimum: EnergyProjectOverviewMinimumDto) => void;
  onLateResolution?: (resolution: EnergyProjectAnalysisResolutionDto) => void;
  onLateIdentityError?: (
    error: unknown,
    minimum: EnergyProjectOverviewMinimumDto,
  ) => void;
  onLateMinimumValidationError?: (error: unknown) => void;
  isCancelled: () => boolean;
  minimumWaitMs?: number;
};

/**
 * Coordinates the Current Overview's minimum/full race without owning React,
 * routing or recovery policy. A late minimum can never be forgotten for
 * identity validation, and it can never replace an already accepted full
 * report.
 */
export const resolveProgressiveCurrentOverview = async (
  input: ProgressiveCurrentOverviewInput,
): Promise<EnergyProjectAnalysisResolutionDto> => {
  let resolvedMinimum: EnergyProjectOverviewMinimumDto | null = null;
  let fullResolutionAccepted = false;
  let acceptedReadyResolution: Extract<EnergyProjectAnalysisResolutionDto, { status: "ready" }> | null = null;
  let minimumIdentityHandled = false;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  const correctLateMinimum = async (minimum: EnergyProjectOverviewMinimumDto) => {
    if (minimumIdentityHandled || !acceptedReadyResolution || input.isCancelled()) return;
    minimumIdentityHandled = true;
    let minimumPublished = false;
    try {
      if (input.minimumMatchesResolution(minimum, acceptedReadyResolution)) return;
      input.onMinimum(minimum);
      minimumPublished = true;
      input.onLateIdentityMismatch?.(minimum);
      const exact = await input.loadExact(minimum);
      if (input.isCancelled()) return;
      if (exact.status !== "ready" || !input.minimumMatchesResolution(minimum, exact)) {
        throw new Error("ENERGYIQ_CURRENT_OVERVIEW_IDENTITY_MISMATCH");
      }
      acceptedReadyResolution = exact;
      input.onLateResolution?.(exact);
    } catch (error) {
      if (!input.isCancelled()) {
        if (!minimumPublished) input.onMinimum(minimum);
        input.onLateIdentityError?.(error, minimum);
      }
    }
  };
  const minimumRequest = input.loadMinimum()
    .then((minimum) => {
      try {
        input.validateMinimum(minimum);
      } catch (error) {
        if (fullResolutionAccepted && !input.isCancelled()) {
          input.onLateMinimumValidationError?.(error);
        }
        throw error;
      }
      resolvedMinimum = minimum;
      if (fullResolutionAccepted) {
        void correctLateMinimum(minimum);
      } else if (!input.isCancelled()) {
        input.onMinimum(minimum);
      }
      return minimum;
    }, () => null);
  const minimumWithinWaitBudget = Promise.race([
    minimumRequest,
    new Promise<null>((resolve) => {
      waitTimer = setTimeout(() => resolve(null), input.minimumWaitMs ?? 2_000);
    }),
  ]).finally(() => {
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
  });

  try {
    const initial = await input.loadInitial();
    if (input.isCancelled()) {
      fullResolutionAccepted = true;
      return initial;
    }
    const waitedMinimum = await minimumWithinWaitBudget;
    if (input.isCancelled()) {
      fullResolutionAccepted = true;
      return initial;
    }
    const minimum = resolvedMinimum ?? waitedMinimum;
    if (minimum
      && initial.status === "ready"
      && !input.minimumMatchesResolution(minimum, initial)) {
      minimumIdentityHandled = true;
      const exact = await input.loadExact(minimum);
      if (exact.status !== "ready" || !input.minimumMatchesResolution(minimum, exact)) {
        throw new Error("ENERGYIQ_CURRENT_OVERVIEW_IDENTITY_MISMATCH");
      }
      acceptedReadyResolution = exact;
      fullResolutionAccepted = true;
      return exact;
    }
    minimumIdentityHandled = minimum !== null;
    acceptedReadyResolution = initial.status === "ready" ? initial : null;
    fullResolutionAccepted = true;
    return initial;
  } finally {
    if (waitTimer) clearTimeout(waitTimer);
  }
};
