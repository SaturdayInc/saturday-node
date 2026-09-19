package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http/httptest"
	"os"

	"saturdaymorning.fit/appsbackend/pkg/api"
)

type activityReader struct {
	api.ActivityManager
	prescription *api.ActivityPrescription
}

func (a activityReader) GetPrescription(context.Context, string, string, string) (*api.ActivityPrescription, *api.ServiceError) {
	return a.prescription, nil
}

func stored(prescription *api.ActivityPrescription) json.RawMessage {
	h := &api.Handler{ActivitySvc: activityReader{prescription: prescription}}
	w := httptest.NewRecorder()
	h.HandleGetActivityPrescription(w, httptest.NewRequest("GET", "/prescription", nil))
	if w.Code != 200 {
		panic(fmt.Sprintf("stored prescription returned %d", w.Code))
	}
	return json.RawMessage(w.Body.Bytes())
}

func main() {
	out := flag.String("out", "", "output JSON path")
	sha := flag.String("backend-sha", "", "backend commit used to generate fixtures")
	flag.Parse()
	if *out == "" || *sha == "" {
		panic("-out and -backend-sha are required")
	}
	safety := api.NewSafetyMetadata()
	safety.MaxSafeFluidMLPerHr, safety.MaxSafeSodiumMGPerHr = 1500, 3000
	attribution := api.Attribution{Text: "Powered by Saturday", LogoURL: "https://saturday.fit/logo.png", Link: "https://saturday.fit"}
	cta := &api.SubscriptionCTA{Message: "Subscribe", SubscribeURL: "https://saturday.fit/", Features: []string{"Exact targets"}}
	incomplete := false
	zero := 0
	precision := &api.Precision{
		ProfileComplete: false,
		MissingFields:   []api.MissingField{{Field: "sweat_level", Required: true, DisplayLabel: "how much you sweat", BandImpact: api.BandImpact{FluidMLPerHr: 100}}},
		Onboarding:      &api.OnboardingInvite{Message: "Complete your profile"},
	}
	exact := &api.ActivityPrescription{TotalCarbG: 120, TotalSodiumMG: 1200, TotalFluidML: 1400, CarbGPerHr: 60, SodiumMGPerHr: 600, FluidMLPerHr: 700, CalculatedAt: 1700000000}
	band := &api.ActivityPrescription{ProfileComplete: &incomplete, CarbRangeGPerHr: "50-70", SodiumRangeMGPerHr: "500-700", FluidRangeMLPerHr: "600-800", CalculatedAt: 1700000000}
	full := api.PrescriptionEnvelope{Tier: "full", Prescription: exact, Safety: safety, Attribution: attribution}
	banded := api.PrescriptionEnvelope{Tier: "full", Prescription: band, Precision: precision, Safety: safety, Attribution: attribution}
	teaser := api.PrescriptionEnvelope{Tier: "teaser", CarbRangeGPerHr: "40-80", SodiumRangeMGPerHr: "400-800", FluidRangeMLPerHr: "500-900", Safety: safety, Attribution: attribution, CTA: cta, Precision: precision, TrialCapReached: true, TrialCapNote: "Daily cap reached", TrialEndsAt: 1700000500000}
	trial := full
	trial.TierSource, trial.TrialEndsAt, trial.TrialCallsRemainingToday = "trial", 1700000500000, &zero
	nutrition := api.NutritionCalculateResponse{Tier: "full", CarbGPerHr: 60, SodiumMGPerHr: 600, FluidMLPerHr: 700, TotalCarbG: 120, TotalSodiumMG: 1200, TotalFluidML: 1400, Safety: safety, Attribution: attribution}
	nutritionBand := api.NutritionCalculateResponse{Tier: "full", CarbRangeGPerHr: "50-70", SodiumRangeMGPerHr: "500-700", FluidRangeMLPerHr: "600-800", Safety: safety, Attribution: attribution, Precision: precision}
	nutritionTeaser := nutritionBand
	nutritionTeaser.Tier, nutritionTeaser.CTA, nutritionTeaser.TrialCapReached, nutritionTeaser.TrialCapNote = "teaser", cta, true, "Daily cap reached"
	nutritionTrial := nutrition
	nutritionTrial.TierSource, nutritionTrial.TrialEndsAt, nutritionTrial.TrialCallsRemainingToday = "trial", 1700000500000, &zero
	activity := api.Activity{ID: "act_1", AthleteID: "ath_1", PartnerID: "partner_1", Type: "bike", DurationMin: 120, ExternalID: "partner-act", Prescription: exact, CreatedAt: 1700000000, UpdatedAt: 1700000000}
	athlete := api.Athlete{ID: "ath_1", PartnerID: "partner_1", Name: "Fixture Athlete", CreatedAt: 1700000000, UpdatedAt: 1700000000}
	batchError := api.BatchError{Index: 1, Code: "invalid_value", Message: "Invalid input"}
	fixtures := map[string]any{
		"_meta":                map[string]string{"backend_sha": *sha, "source": "pkg/api Go JSON types and HandleGetActivityPrescription; synthetic values, no API calls"},
		"activity_exact":       exact,
		"activity_banded":      band,
		"nutrition_exact":      nutrition,
		"nutrition_banded":     nutritionBand,
		"nutrition_teaser":     nutritionTeaser,
		"nutrition_trial":      nutritionTrial,
		"nutrition_zero":       api.NutritionCalculateResponse{Tier: "full", Safety: safety, Attribution: attribution},
		"activity_full":        full,
		"activity_full_banded": banded,
		"activity_teaser":      teaser,
		"activity_trial":       trial,
		"stored_exact":         stored(exact),
		"stored_banded":        stored(band),
		"activity":             activity,
		"athlete":              athlete,
		"feedback":             api.ActivityFeedback{Rating: 4, Notes: "Fixture feedback", CreatedAt: 1700000000},
		"batch_partial":        api.BatchCalculateResponse{Results: []api.NutritionCalculateResponse{nutrition, nutritionBand}, Errors: []api.BatchError{batchError}, Total: 3, Succeeded: 2, Failed: 1, EstimatedMS: 100, ElapsedMS: 100, RequestID: "req_1"},
		"batch_all_failed":     api.BatchCalculateResponse{Results: []api.NutritionCalculateResponse{}, Errors: []api.BatchError{{Index: 0, Code: "invalid_value", Message: "Invalid input"}}, Total: 1, Failed: 1, RequestID: "req_2"},
		"batch_estimate":       api.BatchCalculateResponse{Results: []api.NutritionCalculateResponse{}, Total: 2, EstimatedMS: 100, RequestID: "req_3"},
		"athletes_partial":     api.BatchAthleteResponse{Created: []api.Athlete{athlete}, Errors: []api.BatchError{batchError}, Total: 2, Succeeded: 1, Failed: 1, RequestID: "req_4"},
		"athletes_all_failed":  api.BatchAthleteResponse{Created: []api.Athlete{}, Errors: []api.BatchError{{Index: 0, Code: "invalid_value", Message: "Invalid input"}}, Total: 1, Failed: 1, RequestID: "req_5"},
		"import_plain":         api.ActivityImportResponse{Imported: []api.Activity{activity}, Total: 1, Succeeded: 1, RequestID: "req_6"},
		"import_calculated":    api.ActivityImportResponse{Imported: []api.Activity{activity}, Total: 1, Succeeded: 1, RequestID: "req_7", Prescriptions: []api.ImportPrescriptionItem{{Index: 0, ActivityID: "act_1", Result: &banded}}},
		"import_calc_failed":   api.ActivityImportResponse{Imported: []api.Activity{activity}, Total: 1, Succeeded: 1, RequestID: "req_8", Prescriptions: []api.ImportPrescriptionItem{{Index: 0, ActivityID: "act_1", Code: "storage_error", Message: "Unable to calculate"}}},
		"import_all_failed":    api.ActivityImportResponse{Imported: []api.Activity{}, Errors: []api.BatchError{{Index: 0, Code: "invalid_value", Message: "Invalid input"}}, Total: 1, Failed: 1, RequestID: "req_9"},
	}
	file, err := os.Create(*out)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(fixtures); err != nil {
		panic(err)
	}
	fmt.Printf("Wrote %d contract fixtures to %s\n", len(fixtures)-1, *out)
}
