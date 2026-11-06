import { type ResultAsync, err, ok, okAsync } from "neverthrow";
import { type AppError, notFoundError } from "../errors.js";
import type { PreferredLocationStore } from "./shopping-store.js";
import { safeStorage } from "./result.js";

type ResolvedLocation = { locationId: string; locationName?: string };

export function safeResolveLocationId(
  preferredLocation: PreferredLocationStore,
  locationId?: string,
): ResultAsync<ResolvedLocation, AppError> {
  if (locationId) {
    return okAsync<ResolvedLocation, AppError>({
      locationId,
    });
  }

  return safeStorage(() => preferredLocation.get(), "fetch preferred location").andThen(
    (location) => {
      if (!location) {
        return err(
          notFoundError(
            "No location specified and no preferred store set. Please provide a locationId or set your preferred store using set_preferred_store.",
          ),
        );
      }

      return ok({
        locationId: location.locationId,
        locationName: location.locationName,
      });
    },
  );
}
